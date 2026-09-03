import { useState, useEffect, useCallback, useRef } from 'react';
import type { LayerConfig, LayerState } from '../types';
import { buildPopupFrame } from '../components/Map/popupFrame';
import { layerConfigs } from '../config/layers';
import { fetchGeoJSON } from '../utils/geojson';
import { fetchHotspotsGeoJSON } from '../services/ebird';
import {
  fetchSpeciesObservationsGeoJSON,
  type SpeciesObservationProperties,
} from '../services/speciesObservations';
import { createHeatmapOverlay, type HeatmapOverlay } from '../components/Map/HeatmapOverlay';
import { createKelpOverlay, type KelpOverlay } from '../components/Map/KelpOverlay';
import { getDeckManager, registerDeckManager } from '../components/Map/DeckLayers';
import { MARKER_W, MARKER_H, MARKER_ANCHOR_X, MARKER_ANCHOR_Y } from '../config/markerIcons';
import type { DateRange } from '../types';
import type { UrlLayerUi } from '../services/urlState';

const DAY_MS = 86400000;
const OBSERVATIONS_SOURCE = 'observations:multi';

// EarthAtlas uses one species-level accent color for everything in a layer
// (it varies per-species, not per-source). We match by using a single
// `OBS_ACCENT` for the marker, popup accent, and link borders.
const OBS_ACCENT = '#FF6A00';

// Heatmap-vs-circles is a single-threshold swap rather than a smooth
// crossfade. The previous interpolated approach forced both the canvas
// overlay and every marker to re-style on every zoom tick, which caused
// the map to thrash visibly at zoom 8 (mid-crossfade). The threshold is
// the zoom at which individual dots stop overlapping enough for the
// heatmap to add information.
const HEATMAP_MAX_ZOOM = 9;
const DEFAULT_FALLBACK_ZOOM = 10;

type RenderTier = 'heatmap' | 'circles';
function renderTier(zoom: number): RenderTier {
  return zoom < HEATMAP_MAX_ZOOM ? 'heatmap' : 'circles';
}

/** Compute midpoint of a LineString coordinate array */
function lineMidpoint(coords: number[][]): [number, number] {
  if (coords.length === 0) return [0, 0];
  if (coords.length === 1) return [coords[0][0], coords[0][1]];
  // Walk along the line to find the midpoint by accumulated distance
  let totalDist = 0;
  const segments: number[] = [];
  for (let i = 1; i < coords.length; i++) {
    const dx = coords[i][0] - coords[i - 1][0];
    const dy = coords[i][1] - coords[i - 1][1];
    const d = Math.sqrt(dx * dx + dy * dy);
    segments.push(d);
    totalDist += d;
  }
  const half = totalDist / 2;
  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    if (acc + segments[i] >= half) {
      const frac = (half - acc) / segments[i];
      const lng = coords[i][0] + frac * (coords[i + 1][0] - coords[i][0]);
      const lat = coords[i][1] + frac * (coords[i + 1][1] - coords[i][1]);
      return [lng, lat];
    }
    acc += segments[i];
  }
  const last = coords[coords.length - 1];
  return [last[0], last[1]];
}

/** Planar length of a coordinate array (degrees) — only used for relative ranking. */
function lineLength(coords: number[][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const dx = (coords[i][0] - coords[i - 1][0]) * Math.cos((coords[i][1] * Math.PI) / 180);
    const dy = coords[i][1] - coords[i - 1][1];
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

/**
 * Create a GeoJSON FeatureCollection of midpoints from LineString features.
 * Each point carries `lengthRank` in [0, 1): 0 = the longest line. The marker
 * style uses it to show only the biggest features when zoomed out (see
 * markerVisibleAtZoom), so a layer with hundreds of icons doesn't carpet the
 * county at low zoom.
 */
function createMidpointMarkers(data: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const points: { lng: number; lat: number; len: number }[] = [];
  for (const f of data.features) {
    const geom = f.geometry;
    if (!geom) continue;
    let coordArrays: number[][][];
    if (geom.type === 'LineString') {
      coordArrays = [(geom as GeoJSON.LineString).coordinates];
    } else if (geom.type === 'MultiLineString') {
      coordArrays = (geom as GeoJSON.MultiLineString).coordinates;
    } else {
      continue;
    }
    for (const coords of coordArrays) {
      const [lng, lat] = lineMidpoint(coords);
      points.push({ lng, lat, len: lineLength(coords) });
    }
  }
  const order = points.map((p, i) => [p.len, i] as const).sort((a, b) => b[0] - a[0]);
  const rank = new Array<number>(points.length);
  order.forEach(([, i], pos) => { rank[i] = points.length > 1 ? pos / (points.length - 1) : 0; });
  return {
    type: 'FeatureCollection',
    features: points.map((p, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { mid: i, lengthRank: rank[i] },
    })),
  };
}

/**
 * Screen-grid thinning for midpoint markers. Below zoom 16, only one marker
 * is shown per GRID_PX × GRID_PX cell of the (world-pixel) map, and it's the
 * one whose line is longest. Cells are in absolute Mercator pixel space, so
 * the selection only changes with zoom, not with panning. At zoom 16+ every
 * marker shows.
 */
const MARKER_GRID_PX = 72;
const MARKER_SHOW_ALL_ZOOM = 16;

function worldPixel(lng: number, lat: number, zoom: number): [number, number] {
  const scale = 256 * Math.pow(2, zoom);
  const x = ((lng + 180) / 360) * scale;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return [x, y];
}

/** Ids (the `mid` property) of the markers to show at this zoom. null = show all. */
function selectMarkersForZoom(ml: google.maps.Data, zoom: number): Set<number> | null {
  if (zoom >= MARKER_SHOW_ALL_ZOOM) return null;
  const best = new Map<string, { id: number; rank: number }>();
  ml.forEach((feature) => {
    const g = feature.getGeometry();
    if (!g || g.getType() !== 'Point') return;
    const ll = (g as google.maps.Data.Point).get();
    const [x, y] = worldPixel(ll.lng(), ll.lat(), zoom);
    const key = `${Math.floor(x / MARKER_GRID_PX)}:${Math.floor(y / MARKER_GRID_PX)}`;
    const id = Number(feature.getProperty('mid'));
    const rank = Number(feature.getProperty('lengthRank') ?? 1);
    const cur = best.get(key);
    if (!cur || rank < cur.rank) best.set(key, { id, rank });
  });
  return new Set(Array.from(best.values(), v => v.id));
}

function midpointMarkerStyle(
  ml: google.maps.Data,
  iconUrl: string,
  visible: boolean,
  zoom: number,
): (feature: google.maps.Data.Feature) => google.maps.Data.StyleOptions {
  const chosen = visible ? selectMarkersForZoom(ml, zoom) : null;
  return (feature) => ({
    icon: {
      url: iconUrl,
      scaledSize: new google.maps.Size(MARKER_W, MARKER_H),
      anchor: new google.maps.Point(MARKER_ANCHOR_X, MARKER_ANCHOR_Y),
    },
    clickable: false,
    visible: visible && (chosen === null || chosen.has(Number(feature.getProperty('mid')))),
  });
}

/**
 * Stroke for a layer at this zoom. With `haloByZoom`, the weight interpolates
 * between the two zoom stops and, in the wide half, the halo color/opacity
 * replaces the base stroke (a light, translucent band reads as a glow on
 * satellite imagery; the base dark edge takes over up close).
 */
function strokeAtZoom(config: LayerConfig, zoom: number): { strokeWeight: number; strokeColor: string; strokeOpacity?: number } {
  const base = { strokeWeight: config.style.strokeWeight, strokeColor: config.style.strokeColor, strokeOpacity: config.style.strokeOpacity };
  const h = config.haloByZoom;
  if (!h) return base;
  const t = Math.min(1, Math.max(0, (zoom - h.zoomWide) / (h.zoomNarrow - h.zoomWide)));
  const strokeWeight = h.weightWide + (h.weightNarrow - h.weightWide) * t;
  if (t < 0.6 && h.strokeColorWide) {
    return { strokeWeight, strokeColor: h.strokeColorWide, strokeOpacity: h.strokeOpacityWide ?? base.strokeOpacity };
  }
  return { ...base, strokeWeight };
}

function createInitialState(config: LayerConfig, initialLayerIds?: string[], ui?: UrlLayerUi): LayerState {
  const visible = initialLayerIds
    ? initialLayerIds.includes(config.id)
    : config.visible;
  return {
    vizMode: ui?.vizMode,
    season: ui?.season,
    dateRange: ui?.dateRange,
    config,
    visible,
    loaded: false,
    loading: false,
    error: config.placeholder ? 'Data not yet available' : null,
    featureCount: 0,
    geojsonData: null,
    dataLayer: null,
    opacity: ui?.opacity ?? config.defaultOpacity ?? 1,
  };
}

// Pre-computed bounding boxes for viewport-filtered layers
interface ViewportIndex {
  bboxes: [number, number, number, number][]; // [minLng, minLat, maxLng, maxLat] per feature
}

function bboxesOverlap(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}

function computeFeatureBbox(feature: GeoJSON.Feature): [number, number, number, number] {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;

  function processCoords(coords: unknown) {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number') {
      // Single coordinate [lng, lat, ...]
      const lng = coords[0] as number;
      const lat = coords[1] as number;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    } else {
      for (const child of coords) processCoords(child);
    }
  }

  if (feature.geometry) {
    processCoords((feature.geometry as GeoJSON.Geometry & { coordinates: unknown }).coordinates);
  }

  return [minLng, minLat, maxLng, maxLat];
}

/**
 * @param initialLayerIds  Visible layer ids to start with (from a preset or the URL).
 *                         Undefined = use each layer's `visible` default.
 * @param initialUi        Per-layer opacity / viz mode / season / date range to
 *                         start with (from the URL).
 */
export function useLayers(
  map: google.maps.Map | null,
  initialLayerIds?: string[],
  initialUi?: Record<string, UrlLayerUi>,
) {
  const isVisibleByDefault = useCallback((layerId: string): boolean => {
    if (initialLayerIds) return initialLayerIds.includes(layerId);
    const cfg = layerConfigs.find(c => c.id === layerId);
    return cfg?.visible ?? false;
  }, [initialLayerIds]);

  const [layers, setLayers] = useState<LayerState[]>(() =>
    layerConfigs.map(c => createInitialState(c, initialLayerIds, initialUi?.[c.id]))
  );
  const dataLayersRef = useRef<Map<string, google.maps.Data>>(new Map());
  const markerLayersRef = useRef<Map<string, google.maps.Data>>(new Map());
  const pointLayersRef = useRef<Set<string>>(new Set());
  const rasterLayersRef = useRef<Map<string, google.maps.ImageMapType>>(new Map());
  // Canvas overlays for layers with a custom `renderer` (e.g. kelp squiggles)
  const patternOverlaysRef = useRef<Map<string, KelpOverlay>>(new Map());
  const loadedRef = useRef<Set<string>>(new Set());

  // Viewport-filtered layer data: full GeoJSON + spatial index
  const viewportIndexRef = useRef<Map<string, ViewportIndex>>(new Map());
  const viewportDataRef = useRef<Map<string, GeoJSON.FeatureCollection>>(new Map());

  // Live filter state for multi-source observation layers. The visibility
  // flag, date range, parallel HeatmapLayer, and InfoWindow live on one
  // ref so slider moves and toggles can call the same recompute helpers
  // without racing the React state update.
  const speciesObsStateRef = useRef<
    Map<
      string,
      {
        visible: boolean;
        dateRange: DateRange;
        popup: google.maps.InfoWindow | null;
        heatmap: HeatmapOverlay | null;
        features: GeoJSON.Feature[];
        // Tracks the most recent render tier so a zoom_changed handler
        // can detect actual transitions (and skip the expensive
        // setStyle/setMap when the user just panned/zoomed within a tier).
        tier: RenderTier | null;
      }
    >
  >(new Map());

  function dateFilterBounds(range: DateRange): { startMs: number; endMs: number } {
    const startMs = range.start ? new Date(`${range.start}T00:00:00`).getTime() : -Infinity;
    const endMs = range.end ? new Date(`${range.end}T23:59:59`).getTime() : Infinity;
    return { startMs, endMs };
  }

  /** Recompute the heatmap's point list from the cached features, filtered
   *  by the current date range. Run after slider moves or initial load. */
  const rebuildHeatmapData = useCallback((layerId: string) => {
    const st = speciesObsStateRef.current.get(layerId);
    if (!st || !st.heatmap) return;
    const { startMs, endMs } = dateFilterBounds(st.dateRange);
    const data: google.maps.LatLng[] = [];
    for (const f of st.features) {
      const t = Number(f.properties?.obsTime ?? 0);
      if (t < startMs || t > endMs) continue;
      const geom = f.geometry as GeoJSON.Point | null;
      if (!geom || geom.type !== 'Point') continue;
      const [lng, lat] = geom.coordinates;
      data.push(new google.maps.LatLng(lat, lng));
    }
    st.heatmap.setData(data);
  }, []);

  /** Re-evaluate the Data layer's style fn so the time filter and visibility
   *  toggle both take effect. Reads the latest values from speciesObsStateRef
   *  to stay decoupled from the React state cycle. Recomputes the tier
   *  and only touches Google Maps state that actually needs to change. */
  const applySpeciesObsStyle = useCallback((layerId: string) => {
    const dl = dataLayersRef.current.get(layerId);
    const st = speciesObsStateRef.current.get(layerId);
    if (!dl || !st) return;
    const { startMs, endMs } = dateFilterBounds(st.dateRange);
    const zoom = map?.getZoom() ?? DEFAULT_FALLBACK_ZOOM;
    const tier = st.visible ? renderTier(zoom) : null;

    // Circles: per-feature visibility from the date filter. Style only
    // depends on the date range and the active tier — both of which are
    // stable across most zoom changes — so this `setStyle` does not need
    // to rerun for every zoom tick.
    const showCircles = tier === 'circles';
    dl.setStyle((feature: google.maps.Data.Feature) => {
      const obsTime = Number(feature.getProperty('obsTime') ?? 0);
      const inWindow = obsTime >= startMs && obsTime <= endMs;
      const show = showCircles && inWindow;
      return {
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: '#FF6A00',
          fillOpacity: 0.9,
          strokeColor: '#FFFFFF',
          strokeWeight: 1.5,
          scale: 7,
        },
        clickable: show,
        visible: show,
      };
    });

    // Heatmap: attach or detach with the tier flip. setMap is idempotent
    // when called with the same map twice in a row, so this is cheap.
    if (st.heatmap) {
      if (tier === 'heatmap') {
        st.heatmap.setOpacity(1);
        st.heatmap.setMap(map ?? null);
      } else {
        st.heatmap.setOpacity(0);
        st.heatmap.setMap(null);
      }
    }
    st.tier = tier;
  }, [map]);

  /** Light-touch zoom handler — checks if the render tier actually
   *  changed. If not, skip the expensive setStyle/setMap calls entirely
   *  (the heatmap canvas pans itself via the OverlayView pane). */
  const handleZoomForSpeciesObs = useCallback(() => {
    const zoom = map?.getZoom() ?? DEFAULT_FALLBACK_ZOOM;
    for (const [layerId, st] of speciesObsStateRef.current.entries()) {
      const newTier = st.visible ? renderTier(zoom) : null;
      if (newTier !== st.tier) applySpeciesObsStyle(layerId);
    }
  }, [map, applySpeciesObsStyle]);

  // Toggle non-viewport-filtered vector layer visibility via style
  const setVectorVisible = useCallback((layerId: string, visible: boolean) => {
    const config = layerConfigs.find(c => c.id === layerId);
    if (!config || config.viewportFiltered) return; // viewport layers handled separately
    if (config.tiles) {
      // deck.gl applies the minZoom gate itself; pass the user's intent
      if (map) getDeckManager(map).setVisible(layerId, visible);
      return;
    }
    const dl = dataLayersRef.current.get(layerId);
    if (!dl) return;

    const overlay = patternOverlaysRef.current.get(layerId);
    if (overlay) overlay.setMap(visible ? (map ?? null) : null);

    // Multi-source observation layers carry a time filter alongside
    // visibility — route both through the dedicated style applier so the
    // date window survives toggling. Also close any open popup when the
    // layer is hidden, since the popup's source feature may be filtered.
    if (config.source === OBSERVATIONS_SOURCE) {
      const st = speciesObsStateRef.current.get(layerId);
      if (st) {
        st.visible = visible;
        if (!visible && st.popup) st.popup.close();
        applySpeciesObsStyle(layerId);
      }
      return;
    }

    // Layers with custom marker icons
    if (config.markerIcon) {
      // Check if this layer has a midpoint marker layer (LineString with icons)
      const ml = markerLayersRef.current.get(layerId);
      if (ml) {
        // LineString layer: style the lines normally, toggle midpoint markers
        dl.setStyle({
          fillColor: config.style.fillColor,
          fillOpacity: config.style.fillOpacity,
          strokeColor: config.style.strokeColor,
          strokeWeight: config.style.strokeWeight,
          clickable: visible,
          visible,
        });
        ml.setStyle(midpointMarkerStyle(ml, config.markerIcon, visible, map?.getZoom() ?? 0));
      } else {
        // Point layer: use icon directly
        dl.setStyle(() => ({
          icon: {
            url: config.markerIcon!,
            scaledSize: new google.maps.Size(MARKER_W, MARKER_H),
            anchor: new google.maps.Point(MARKER_ANCHOR_X, MARKER_ANCHOR_Y),
          },
          clickable: visible,
          visible,
        }));
      }
      return;
    }

    if (config.styleByProperty) {
      const sbp = config.styleByProperty;
      dl.setStyle((feature: google.maps.Data.Feature) => {
        const val = String(feature.getProperty(sbp.property) ?? '');
        const override = sbp.values[val] ?? sbp.defaultStyle ?? {};
        return {
          fillColor: override.fillColor ?? config.style.fillColor,
          fillOpacity: override.fillOpacity ?? config.style.fillOpacity,
          strokeColor: override.strokeColor ?? config.style.strokeColor,
          strokeWeight: override.strokeWeight ?? config.style.strokeWeight,
          strokeOpacity: override.strokeOpacity ?? config.style.strokeOpacity,
          clickable: visible,
          visible,
        };
      });
    } else if (pointLayersRef.current.has(layerId)) {
      dl.setStyle((feature: google.maps.Data.Feature) => {
        const geomType = feature.getGeometry()?.getType();
        if (geomType === 'Point') {
          return {
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              fillColor: config.style.fillColor ?? config.style.strokeColor,
              fillOpacity: config.style.fillOpacity ?? 1,
              strokeColor: config.style.strokeColor,
              strokeWeight: config.style.strokeWeight,
              scale: 7,
            },
            clickable: visible,
            visible,
          };
        }
        return {
          fillColor: config.style.fillColor,
          fillOpacity: config.style.fillOpacity,
          strokeColor: config.style.strokeColor,
          strokeWeight: config.style.strokeWeight,
          clickable: visible,
          visible,
        };
      });
    } else {
      dl.setStyle({
        fillColor: config.style.fillColor,
        fillOpacity: config.style.fillOpacity,
        ...strokeAtZoom(config, map?.getZoom() ?? 0),
        clickable: visible,
        visible,
      });
    }
  }, [applySpeciesObsStyle, map]);

  // Update viewport-filtered layers: clear and re-add only features in current bounds
  const updateViewportLayers = useCallback(() => {
    if (!map) return;

    const zoom = map.getZoom() ?? 0;
    const bounds = map.getBounds();

    setLayers(prev => {
      // Read current layer state but don't trigger re-render unless needed
      for (const layer of prev) {
        if (!layer.config.viewportFiltered || !layer.loaded) continue;

        const dl = dataLayersRef.current.get(layer.config.id);
        const index = viewportIndexRef.current.get(layer.config.id);
        const data = viewportDataRef.current.get(layer.config.id);
        if (!dl || !index || !data) continue;

        const minZoom = layer.config.minZoom ?? 0;
        const shouldShow = layer.visible && zoom >= minZoom && bounds;

        // Clear existing features from the Data layer
        dl.forEach(f => dl.remove(f));

        if (!shouldShow || !bounds) continue;

        // Compute map bbox
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const mapBbox: [number, number, number, number] = [sw.lng(), sw.lat(), ne.lng(), ne.lat()];

        // Filter features by bbox overlap and add to Data layer
        const viewportFeatures: GeoJSON.Feature[] = [];
        for (let i = 0; i < data.features.length; i++) {
          if (bboxesOverlap(index.bboxes[i], mapBbox)) {
            viewportFeatures.push(data.features[i]);
          }
        }

        if (viewportFeatures.length > 0) {
          dl.addGeoJson({ type: 'FeatureCollection', features: viewportFeatures });
        }
      }

      return prev; // no state change needed
    });
  }, [map]);

  // Load GeoJSON data for vector layers, create ImageMapType for raster layers
  useEffect(() => {
    if (!map) return;

    layerConfigs.forEach(config => {
      if (config.placeholder || loadedRef.current.has(config.id)) return;

      // --- Raster tile layers (pre-computed tiles) ---
      if (config.layerType === 'raster' && config.tileUrl) {
        loadedRef.current.add(config.id);

        const tileUrl = config.tileUrl;
        const tileMinZoom = config.minZoom ?? 0;
        const tileMaxZoom = 19;
        const visibleByDefault = isVisibleByDefault(config.id);
        const imageMapType = new google.maps.ImageMapType({
          getTileUrl(coord, zoom) {
            if (zoom < tileMinZoom || zoom > tileMaxZoom) return null;
            return tileUrl
              .replace('{z}', String(zoom))
              .replace('{x}', String(coord.x))
              .replace('{y}', String(coord.y));
          },
          tileSize: new google.maps.Size(256, 256),
          maxZoom: tileMaxZoom,
          name: config.id,
          opacity: visibleByDefault ? (initialUi?.[config.id]?.opacity ?? config.defaultOpacity ?? 0.7) : 0,
        });

        rasterLayersRef.current.set(config.id, imageMapType);
        map.overlayMapTypes.insertAt(0, imageMapType);

        setLayers(prev => prev.map(l =>
          l.config.id === config.id
            ? { ...l, loaded: true, opacity: l.opacity ?? config.defaultOpacity ?? 0.7 }
            : l
        ));
        return;
      }

      // --- Dynamic raster layers (tile URL fetched from API) ---
      if (config.layerType === 'dynamic-raster') {
        loadedRef.current.add(config.id);
        setLayers(prev => prev.map(l =>
          l.config.id === config.id
            ? { ...l, loaded: true, opacity: l.opacity ?? config.defaultOpacity ?? 0.7 }
            : l
        ));
        return;
      }

      // --- Multi-source species observations (GBIF + iNaturalist + eBird) ---
      if (config.source === OBSERVATIONS_SOURCE && config.species) {
        loadedRef.current.add(config.id);
        setLayers(prev => prev.map(l =>
          l.config.id === config.id ? { ...l, loading: true } : l
        ));

        const center = map.getCenter();
        const lat = center?.lat() ?? 48.53;
        const lng = center?.lng() ?? -123.02;
        const radiusKm = config.species.defaultRadiusKm ?? 80;
        const daysBack = config.species.defaultDaysBack ?? 365;
        const today = new Date();
        const startDate = new Date(today.getTime() - daysBack * DAY_MS)
          .toISOString().slice(0, 10);

        fetchSpeciesObservationsGeoJSON({
          species: config.species,
          lat,
          lng,
          radiusKm,
          startDate,
        }).then((data) => {
          const dataLayer = new google.maps.Data({ map });
          dataLayer.addGeoJson(data);
          dataLayersRef.current.set(config.id, dataLayer);

          // Build a parallel HeatmapOverlay for low-zoom density display.
          // Custom 2D-canvas implementation (see HeatmapOverlay.ts) —
          // Google's google.maps.visualization.HeatmapLayer was
          // deprecated in May 2025 and stops working in May 2026, so we
          // can't rely on it. Opacity is managed by
          // applySpeciesObsStyle/crossfadeOpacities.
          const heatmapPoints = data.features
            .map((f) => {
              const g = f.geometry as GeoJSON.Point | null;
              if (!g || g.type !== 'Point') return null;
              return new google.maps.LatLng(g.coordinates[1], g.coordinates[0]);
            })
            .filter((p): p is google.maps.LatLng => p !== null);
          const heatmap = createHeatmapOverlay({
            data: heatmapPoints,
            radius: 32,
            opacity: 0,
          });

          const initialVisible = isVisibleByDefault(config.id);
          const initialRange: DateRange = initialUi?.[config.id]?.dateRange ?? { start: null, end: null };
          speciesObsStateRef.current.set(config.id, {
            visible: initialVisible,
            dateRange: initialRange,
            popup: null,
            heatmap,
            features: data.features,
            tier: null,
          });
          applySpeciesObsStyle(config.id);

          // Click → open a rich InfoWindow at the observation's coords.
          // Mirrors the EarthAtlas popup (photo, place, date, observer,
          // source badge, view-on-source link).
          dataLayer.addListener('click', (event: google.maps.Data.MouseEvent) => {
            const props: Record<string, unknown> = {};
            event.feature.forEachProperty((value, key) => {
              props[key] = value;
            });
            const html = buildObservationPopupHTML(
              props as unknown as SpeciesObservationProperties,
            );
            const geom = event.feature.getGeometry() as google.maps.Data.Point;
            const position = geom?.get?.();
            const st = speciesObsStateRef.current.get(config.id);
            if (!st) return;
            if (!st.popup) st.popup = new google.maps.InfoWindow({ maxWidth: 300 });
            st.popup.setContent(html);
            if (position) st.popup.setPosition(position);
            st.popup.open({ map });
          });

          setLayers(prev => prev.map(l =>
            l.config.id === config.id
              ? {
                  ...l,
                  loading: false,
                  loaded: true,
                  featureCount: data.features.length,
                  geojsonData: data,
                  dataLayer,
                  dateRange: initialRange,
                }
              : l
          ));
        }).catch((err) => {
          console.error('[observations] fetch failed', err);
          setLayers(prev => prev.map(l =>
            l.config.id === config.id
              ? { ...l, loading: false, error: 'Failed to load observations' }
              : l
          ));
        });
        return;
      }

      // --- eBird hotspot layer (fetched from API) ---
      if (config.source === 'ebird:hotspots') {
        loadedRef.current.add(config.id);

        setLayers(prev => prev.map(l =>
          l.config.id === config.id ? { ...l, loading: true } : l
        ));

        // Fetch hotspots centered on the current map center
        const center = map.getCenter();
        const lat = center?.lat() ?? 48.53;
        const lng = center?.lng() ?? -123.02;

        fetchHotspotsGeoJSON(lat, lng, 50).then(data => {
          const dataLayer = new google.maps.Data({ map });
          dataLayer.addGeoJson(data);

          const ebirdVisible = isVisibleByDefault(config.id);
          dataLayer.setStyle(() => ({
            icon: config.markerIcon ? {
              url: config.markerIcon,
              scaledSize: new google.maps.Size(MARKER_W, MARKER_H),
              anchor: new google.maps.Point(MARKER_ANCHOR_X, MARKER_ANCHOR_Y),
            } : undefined,
            clickable: true,
            visible: ebirdVisible,
          }));

          // Click opens eBird hotspot page
          dataLayer.addListener('click', (event: google.maps.Data.MouseEvent) => {
            const url = event.feature.getProperty('ebirdUrl');
            if (url) window.open(url as string, '_blank');
          });

          dataLayersRef.current.set(config.id, dataLayer);

          setLayers(prev => prev.map(l =>
            l.config.id === config.id
              ? {
                  ...l,
                  loading: false,
                  loaded: true,
                  featureCount: data.features.length,
                  geojsonData: data,
                  dataLayer,
                }
              : l
          ));
        }).catch(() => {
          setLayers(prev => prev.map(l =>
            l.config.id === config.id
              ? { ...l, loading: false, error: 'Failed to load eBird hotspots' }
              : l
          ));
        });
        return;
      }

      // --- Vector-tile layers (deck.gl) — nothing to download up front ---
      if (config.tiles) {
        loadedRef.current.add(config.id);
        const deck = getDeckManager(map);
        registerDeckManager(deck);
        deck.setLayer(config, isVisibleByDefault(config.id));
        deck.setZoom(map.getZoom() ?? 0);
        setLayers(prev => prev.map(l =>
          l.config.id === config.id ? { ...l, loading: false, loaded: true, featureCount: 0 } : l
        ));
        return;
      }

      // --- Vector GeoJSON layers ---
      loadedRef.current.add(config.id);

      setLayers(prev => prev.map(l =>
        l.config.id === config.id ? { ...l, loading: true } : l
      ));

      fetchGeoJSON(config.source).then(data => {
        if (!data) {
          setLayers(prev => prev.map(l =>
            l.config.id === config.id
              ? { ...l, loading: false, error: 'Failed to load data' }
              : l
          ));
          return;
        }

        if (config.viewportFiltered) {
          // --- Viewport-filtered layer ---
          // Store full data for spatial queries, build bbox index, create empty Data layer
          viewportDataRef.current.set(config.id, data);

          const bboxes = data.features.map(computeFeatureBbox);
          viewportIndexRef.current.set(config.id, { bboxes });

          // Data layer starts empty — features added on idle event
          const dataLayer = new google.maps.Data({ map });
          dataLayer.setStyle({
            fillColor: config.style.fillColor,
            fillOpacity: config.style.fillOpacity,
            strokeColor: config.style.strokeColor,
            strokeWeight: config.style.strokeWeight,
            clickable: true,
          });

          dataLayersRef.current.set(config.id, dataLayer);

          setLayers(prev => prev.map(l =>
            l.config.id === config.id
              ? {
                  ...l,
                  loading: false,
                  loaded: true,
                  featureCount: data.features.length,
                  geojsonData: data,
                  dataLayer,
                }
              : l
          ));

          // Trigger initial viewport load
          updateViewportLayers();
        } else {
          // --- Standard vector layer ---
          const dataLayer = new google.maps.Data({ map });
          dataLayer.addGeoJson(data);

          const currentZoom = map.getZoom() ?? 0;
          const aboveMinZoom = config.minZoom == null || currentZoom >= config.minZoom;
          const shouldShow = isVisibleByDefault(config.id) && aboveMinZoom;

          const hasPoints = data.features.some(f =>
            f.geometry?.type === 'Point' || f.geometry?.type === 'MultiPoint'
          );

          if (config.markerIcon && hasPoints) {
            dataLayer.setStyle(() => ({
              icon: {
                url: config.markerIcon!,
                scaledSize: new google.maps.Size(MARKER_W, MARKER_H),
                anchor: new google.maps.Point(MARKER_ANCHOR_X, MARKER_ANCHOR_Y),
              },
              clickable: shouldShow,
              visible: shouldShow,
            }));
          } else if (config.styleByProperty) {
            const sbp = config.styleByProperty;
            dataLayer.setStyle((feature) => {
              const val = String(feature.getProperty(sbp.property) ?? '');
              const override = sbp.values[val] ?? sbp.defaultStyle ?? {};
              return {
                fillColor: override.fillColor ?? config.style.fillColor,
                fillOpacity: override.fillOpacity ?? config.style.fillOpacity,
                strokeColor: override.strokeColor ?? config.style.strokeColor,
                strokeWeight: override.strokeWeight ?? config.style.strokeWeight,
                strokeOpacity: override.strokeOpacity ?? config.style.strokeOpacity,
                clickable: shouldShow,
                visible: shouldShow,
              };
            });
          } else if (hasPoints) {
            pointLayersRef.current.add(config.id);
            dataLayer.setStyle((feature) => {
              const geomType = feature.getGeometry()?.getType();
              if (geomType === 'Point') {
                return {
                  icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    fillColor: config.style.fillColor ?? config.style.strokeColor,
                    fillOpacity: config.style.fillOpacity ?? 1,
                    strokeColor: config.style.strokeColor,
                    strokeWeight: config.style.strokeWeight,
                    scale: 7,
                  },
                  clickable: shouldShow,
                  visible: shouldShow,
                };
              }
              return {
                fillColor: config.style.fillColor,
                fillOpacity: config.style.fillOpacity,
                strokeColor: config.style.strokeColor,
                strokeWeight: config.style.strokeWeight,
                clickable: shouldShow,
                visible: shouldShow,
              };
            });
          } else {
            dataLayer.setStyle({
              fillColor: config.style.fillColor,
              fillOpacity: config.style.fillOpacity,
              ...strokeAtZoom(config, currentZoom),
              clickable: shouldShow,
              visible: shouldShow,
            });
          }

          dataLayersRef.current.set(config.id, dataLayer);

          // Custom-rendered layers: paint on a canvas overlay above the (transparent) Data layer
          if (config.renderer === 'kelp-squiggle') {
            const overlay = createKelpOverlay(data);
            overlay.setMap(shouldShow ? map : null);
            patternOverlaysRef.current.set(config.id, overlay);
          }

          // For LineString layers with a markerIcon, add midpoint markers
          if (config.markerIcon) {
            const hasLines = data.features.some(f =>
              f.geometry?.type === 'LineString' || f.geometry?.type === 'MultiLineString'
            );
            if (hasLines) {
              const midpoints = createMidpointMarkers(data);
              const markerLayer = new google.maps.Data({ map });
              markerLayer.addGeoJson(midpoints);
              markerLayer.setStyle(midpointMarkerStyle(markerLayer, config.markerIcon, shouldShow, map.getZoom() ?? 0));
              markerLayersRef.current.set(config.id, markerLayer);
            }
          }

          setLayers(prev => prev.map(l =>
            l.config.id === config.id
              ? {
                  ...l,
                  loading: false,
                  loaded: true,
                  featureCount: data.features.length,
                  geojsonData: data,
                  dataLayer,
                }
              : l
          ));
        }
      });
    });
  }, [map, updateViewportLayers, isVisibleByDefault, applySpeciesObsStyle, initialUi]);

  // Update viewport-filtered layers on map idle (after pan/zoom settles)
  useEffect(() => {
    if (!map) return;

    const listener = map.addListener('idle', updateViewportLayers);
    return () => google.maps.event.removeListener(listener);
  }, [map, updateViewportLayers]);

  // Handle minZoom visibility for non-viewport-filtered vector and raster layers
  useEffect(() => {
    if (!map) return;

    const listener = map.addListener('zoom_changed', () => {
      const zoom = map.getZoom() ?? 0;

      // Cheap: only re-style observation layers when the heatmap↔circles
      // tier actually changes. handleZoomForSpeciesObs compares the new
      // tier against the cached one and no-ops when they match — which is
      // the case for almost every zoom tick during a smooth zoom.
      handleZoomForSpeciesObs();

      getDeckManager(map).setZoom(zoom);

      setLayers(prev => prev.map(layer => {
        if (layer.config.tiles) return layer; // deck.gl gates these itself
        // Midpoint-marker layers thin out with zoom — re-style on every change
        const ml = layer.config.markerIcon ? markerLayersRef.current.get(layer.config.id) : undefined;
        if (ml && layer.loaded) {
          ml.setStyle(midpointMarkerStyle(ml, layer.config.markerIcon!, layer.visible, zoom));
        }

        const minZoom = layer.config.minZoom;
        if (minZoom == null) {
          // Halo strokes track zoom even without a minZoom gate
          if (layer.config.haloByZoom && layer.loaded && !layer.config.viewportFiltered) {
            setVectorVisible(layer.config.id, layer.visible);
          }
          return layer;
        }
        // Viewport-filtered layers are handled by the idle listener
        if (layer.config.viewportFiltered) return layer;

        // Raster layers
        const raster = rasterLayersRef.current.get(layer.config.id);
        if (raster && layer.loaded) {
          const shouldShow = layer.visible && zoom >= minZoom;
          raster.setOpacity(shouldShow ? (layer.opacity ?? 0.7) : 0);
          return layer;
        }

        // Standard vector layers
        if (!layer.loaded) return layer;
        const shouldShow = layer.visible && zoom >= minZoom;
        setVectorVisible(layer.config.id, shouldShow);
        return layer;
      }));
    });

    return () => google.maps.event.removeListener(listener);
  }, [map, setVectorVisible, handleZoomForSpeciesObs]);

  const toggleLayer = useCallback((layerId: string) => {
    setLayers(prev => prev.map(layer => {
      if (layer.config.id !== layerId) return layer;
      const newVisible = !layer.visible;

      // Raster layers (both static and dynamic) — toggle via opacity
      const raster = rasterLayersRef.current.get(layerId);
      if (raster || layer.config.layerType === 'dynamic-raster') {
        if (raster) {
          const zoom = map?.getZoom() ?? 0;
          const minZoom = layer.config.minZoom;
          const inRange = minZoom == null || zoom >= minZoom;
          raster.setOpacity(newVisible && inRange ? (layer.opacity ?? 0.7) : 0);
        }
        return { ...layer, visible: newVisible };
      }

      // Vector-tile layers — deck.gl handles the zoom gate
      if (layer.config.tiles) {
        if (map) getDeckManager(map).setVisible(layerId, newVisible);
        return { ...layer, visible: newVisible };
      }

      // Viewport-filtered layers — update on next idle
      if (layer.config.viewportFiltered) {
        // If toggling off, clear features immediately
        if (!newVisible) {
          const dl = dataLayersRef.current.get(layerId);
          if (dl) dl.forEach(f => dl.remove(f));
        }
        // The idle listener will handle re-populating when toggled on
        // Trigger an update in case the map is already idle
        setTimeout(updateViewportLayers, 0);
        return { ...layer, visible: newVisible };
      }

      // Standard vector layers
      if (map) {
        const zoom = map.getZoom() ?? 0;
        const minZoom = layer.config.minZoom;
        const shouldShow = newVisible && (minZoom == null || zoom >= minZoom);
        setVectorVisible(layerId, shouldShow);
      }
      return { ...layer, visible: newVisible };
    }));
  }, [map, setVectorVisible, updateViewportLayers]);

  const setAllVisible = useCallback((layerIds: string[], visible: boolean) => {
    const idSet = new Set(layerIds);
    setLayers(prev => prev.map(layer => {
      if (!idSet.has(layer.config.id)) return layer;
      if (layer.config.placeholder) return layer;

      // Raster layers
      const raster = rasterLayersRef.current.get(layer.config.id);
      if (raster) {
        const zoom = map?.getZoom() ?? 0;
        const minZoom = layer.config.minZoom;
        const inRange = minZoom == null || zoom >= minZoom;
        raster.setOpacity(visible && inRange ? (layer.opacity ?? 0.7) : 0);
        return { ...layer, visible };
      }

      // Viewport-filtered layers
      if (layer.config.viewportFiltered) {
        if (!visible) {
          const dl = dataLayersRef.current.get(layer.config.id);
          if (dl) dl.forEach(f => dl.remove(f));
        }
        return { ...layer, visible };
      }

      // Standard vector layers
      if (map) {
        const zoom = map.getZoom() ?? 0;
        const minZoom = layer.config.minZoom;
        const shouldShow = visible && (minZoom == null || zoom >= minZoom);
        setVectorVisible(layer.config.id, shouldShow);
      }
      return { ...layer, visible };
    }));

    // Trigger viewport update for any viewport-filtered layers in this group
    setTimeout(updateViewportLayers, 0);
  }, [map, setVectorVisible, updateViewportLayers]);

  const setLayerOpacity = useCallback((layerId: string, opacity: number) => {
    const raster = rasterLayersRef.current.get(layerId);
    if (raster) {
      setLayers(prev => prev.map(layer => {
        if (layer.config.id !== layerId) return layer;
        if (layer.visible) {
          const zoom = map?.getZoom() ?? 0;
          const minZoom = layer.config.minZoom;
          const inRange = minZoom == null || zoom >= minZoom;
          raster.setOpacity(inRange ? opacity : 0);
        }
        return { ...layer, opacity };
      }));
    }
  }, [map]);

  // Update dynamic raster layer with a new tile URL (creates/replaces ImageMapType)
  const setDynamicRasterTileUrl = useCallback((layerId: string, tileUrl: string) => {
    if (!map) return;

    // Remove existing overlay if present
    const existing = rasterLayersRef.current.get(layerId);
    if (existing) {
      for (let i = 0; i < map.overlayMapTypes.getLength(); i++) {
        if (map.overlayMapTypes.getAt(i) === existing) {
          map.overlayMapTypes.removeAt(i);
          break;
        }
      }
    }

    const config = layerConfigs.find(c => c.id === layerId);
    const tileMinZoom = config?.minZoom ?? 0;

    const imageMapType = new google.maps.ImageMapType({
      getTileUrl(coord, zoom) {
        if (zoom < tileMinZoom) return null;
        return tileUrl
          .replace('{z}', String(zoom))
          .replace('{x}', String(coord.x))
          .replace('{y}', String(coord.y));
      },
      tileSize: new google.maps.Size(256, 256),
      name: layerId,
      opacity: 0,
    });

    rasterLayersRef.current.set(layerId, imageMapType);
    map.overlayMapTypes.insertAt(0, imageMapType);

    // Set opacity based on current layer state
    setLayers(prev => prev.map(layer => {
      if (layer.config.id !== layerId) return layer;
      const zoom = map.getZoom() ?? 0;
      const inRange = tileMinZoom == null || zoom >= tileMinZoom;
      imageMapType.setOpacity(layer.visible && inRange ? (layer.opacity ?? 0.7) : 0);
      return layer;
    }));
  }, [map]);

  const getDataLayer = useCallback((layerId: string) => {
    return dataLayersRef.current.get(layerId) ?? null;
  }, []);

  /** Update the date filter for a multi-source observation layer.
   *  Refilters in place — no API call. `null` bounds clear that side
   *  of the constraint (show everything earlier / later). Rebuilds the
   *  heatmap point list too so the density blob reflects the filter. */
  const setLayerDateRange = useCallback((layerId: string, dateRange: DateRange) => {
    const st = speciesObsStateRef.current.get(layerId);
    if (st) {
      st.dateRange = dateRange;
      rebuildHeatmapData(layerId);
      applySpeciesObsStyle(layerId);
    }
    setLayers(prev => prev.map(l =>
      l.config.id === layerId ? { ...l, dateRange } : l
    ));
  }, [applySpeciesObsStyle, rebuildHeatmapData]);

  /** Update UI-only layer state (viz mode, season) that the URL mirrors. */
  const setLayerUi = useCallback((layerId: string, patch: { vizMode?: string; season?: string }) => {
    setLayers(prev => prev.map(l => (l.config.id === layerId ? { ...l, ...patch } : l)));
  }, []);

  return { layers, toggleLayer, setAllVisible, setLayerOpacity, setDynamicRasterTileUrl, setLayerDateRange, setLayerUi, getDataLayer };
}

// ─── Observation popup HTML builder ─────────────────────────────────────
// Mirrors the EarthAtlas popup style (src/explore/components/ExploreMap.jsx
// buildPopupHTML): photo on top, common+scientific name, place/date/observer
// metadata, source badge, "View observation ↗" external link.

function formatObsDate(dateStr: string, timeStr: string | null): string {
  try {
    const d = new Date(`${dateStr}T${timeStr || '12:00:00'}`);
    const datePart = d.toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
    if (!timeStr) return datePart;
    const timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${datePart} at ${timePart}`;
  } catch {
    return dateStr;
  }
}

function buildObservationPopupHTML(p: SpeciesObservationProperties): string {
  const when = formatObsDate(p.obsDate, p.obsTimeStr);
  const stats = [
    { value: when.split(',')[0] || when, label: when.includes(',') ? when.split(',').slice(1).join(',').trim() : 'Observed' },
    ...(p.place ? [{ value: p.place, label: 'Location' }] : []),
    { value: p.source, label: p.observer ? `Observer ${p.observer}` : 'Source' },
  ];
  return buildPopupFrame({
    id: `obs-${Date.now()}`,
    accent: OBS_ACCENT,
    layerName: 'Species observations',
    swatch: 'point',
    title: p.comName,
    subtitle: [p.sciName, p.count != null ? `${p.count} ${p.count === 1 ? 'individual' : 'individuals'}` : ''].filter(Boolean).join(' · '),
    photos: p.photoUrl ? [{ url: p.photoUrl, caption: `Observer's photo`, credit: `${p.observer ? p.observer + ' via ' : ''}${p.source}` }] : [],
    stats,
    source: { credit: `${p.source}` },
    footerButtons: [{ label: 'View observation ↗', href: p.sourceUrl }],
  });
}
