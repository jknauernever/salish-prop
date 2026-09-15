/**
 * deck.gl on top of Google Maps — the GPU path for everything dense.
 *
 * Two kinds of entry share one GoogleMapsOverlay:
 *  - MVT tile layers (parcels, buildings): only the tiles in view download.
 *  - GeoJSON layers (`config.gpu`): the Friends shoreline datasets, already in
 *    memory, drawn as GeoJsonLayers instead of google.maps.Data. Data layers
 *    put one SVG element per feature on the main thread; at 14,000 features
 *    that was most of the pan/zoom cost. Here a layer is one GPU draw call.
 *
 * Per GeoJSON entry deck gets, bottom to top: an optional casing (wider,
 * lighter line — also a forgiving click target), the layer itself (lines /
 * fills / point icons), and an optional pin layer (midpoint or centroid
 * markers, already thinned by zoom in useLayers). Styling mirrors the layer
 * config exactly, so nothing changes visually.
 *
 * Clicks and hovers are re-broadcast as window events; FeaturePopup routes
 * them like Data-layer events (chooser, popup, hover label).
 */
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { MVTLayer } from '@deck.gl/geo-layers';
import { GeoJsonLayer, IconLayer } from '@deck.gl/layers';
import type { Layer, PickingInfo } from '@deck.gl/core';
import type { LayerConfig } from '../../types';
import { MARKER_W, MARKER_H, MARKER_ANCHOR_Y } from '../../config/markerIcons';

export const DECK_CLICK_EVENT = 'ssx-deck-click';
export const DECK_HOVER_EVENT = 'ssx-deck-hover';

export interface DeckClickDetail {
  layerId: string;
  properties: Record<string, unknown>;
  lat: number;
  lng: number;
  /** The clicked feature (GeoJSON layers) — lets the popup highlight it. */
  feature?: GeoJSON.Feature;
  /** True when a pin (marker) was clicked rather than the geometry itself. */
  pin?: boolean;
}

export interface DeckHoverDetail {
  /** Null when the cursor left every deck layer. */
  layerId: string | null;
  properties: Record<string, unknown> | null;
  x: number;
  y: number;
}

/** San Juan County bounding box [west, south, east, north] — the area the tiles cover. */
const TILE_EXTENT: [number, number, number, number] = [-123.35, 48.33, -122.65, 48.85];

type RGBA = [number, number, number, number];

/** A pin: position, the source feature's properties, and its icon URL. */
export interface DeckPin {
  position: [number, number];
  properties: Record<string, unknown>;
  icon: string;
  /** Selection id used by the zoom thinning. */
  mid: number;
}

interface Entry {
  config: LayerConfig;
  visible: boolean;
  /** User asked to see this layer at any zoom (ignore config.minZoom). */
  ignoreGate?: boolean;
  /** GeoJSON entries only */
  data?: GeoJSON.FeatureCollection;
  /** Point features to draw (after Friends-pin spacing); null = all */
  pointFilter?: Set<number> | null;
  pins?: DeckPin[];
  /** Which pins to draw at this zoom; null = all */
  pinFilter?: Set<number> | null;
}

function hexToRgb(hex: string | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!hex) return fallback;
  const m = hex.replace('#', '');
  if (m.length !== 6) return fallback;
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}

function rgba(hex: string | undefined, opacity: number | undefined, fallback: [number, number, number] = [13, 79, 79]): RGBA {
  const [r, g, b] = hexToRgb(hex, fallback);
  return [r, g, b, Math.round(Math.min(1, Math.max(0, opacity ?? 1)) * 255)];
}

/** Stroke width for a layer at this zoom (mirrors useLayers' strokeAtZoom for haloByZoom layers). */
function strokeWeightAt(config: LayerConfig, zoom: number): number {
  const h = config.haloByZoom;
  if (!h) return config.style.strokeWeight;
  const t = Math.min(1, Math.max(0, (zoom - h.zoomWide) / (h.zoomNarrow - h.zoomWide)));
  return h.weightWide + (h.weightNarrow - h.weightWide) * t;
}

/** Strip the sub-layer suffix so events name the layer config. */
function baseId(deckLayerId: string): string {
  return deckLayerId.replace(/__(casing|pins|hit)$/, '');
}

class DeckManager {
  private overlay: GoogleMapsOverlay;
  private entries = new Map<string, Entry>();
  private live = new Map<string, Layer>();
  private zoom: number;
  private hovering: string | null = null;

  constructor(map: google.maps.Map) {
    this.zoom = map.getZoom() ?? 0;
    this.overlay = new GoogleMapsOverlay({
      // Google's interleaved WebGLOverlayView path hands deck a 16384 px canvas
      // on this vector map, so everything draws into the top-left corner. The
      // classic overlay (deck's own canvas, sized to the map div) is reliable.
      interleaved: false,
      // Phones: render deck at 1× — a 3× framebuffer on top of Google's own
      // WebGL canvas is more GPU memory than iOS Chrome's tab can afford.
      useDevicePixels: window.matchMedia('(max-width: 639px)').matches ? 1 : true,
      pickingRadius: 6,
      layers: [],
      getCursor: ({ isHovering }) => (isHovering ? 'pointer' : 'grab'),
      onClick: (info: PickingInfo) => {
        if (!info.layer || !info.object || !info.coordinate) return;
        const id = baseId(info.layer.id);
        const isPin = info.layer.id.endsWith('__pins');
        const obj = info.object as { properties?: Record<string, unknown> };
        const properties = obj.properties ?? {};
        const feature = !isPin && (obj as GeoJSON.Feature).type === 'Feature' ? (obj as GeoJSON.Feature) : undefined;
        window.dispatchEvent(new CustomEvent<DeckClickDetail>(DECK_CLICK_EVENT, {
          detail: { layerId: id, properties, lat: info.coordinate[1], lng: info.coordinate[0], feature, pin: isPin },
        }));
      },
      onHover: (info: PickingInfo) => {
        const id = info.layer && info.object ? baseId(info.layer.id) : null;
        if (id === null && this.hovering === null) return;
        this.hovering = id;
        const properties = id ? ((info.object as { properties?: Record<string, unknown> }).properties ?? {}) : null;
        window.dispatchEvent(new CustomEvent<DeckHoverDetail>(DECK_HOVER_EVENT, {
          detail: { layerId: id, properties, x: info.x, y: info.y },
        }));
      },
    });
    this.overlay.setMap(map);
    // Debug handle (harmless): lets us inspect deck's viewport from the console
    (window as unknown as Record<string, unknown>).__ssxDeck = this.overlay;
  }

  /** Add or update a tile layer. Visibility here already includes the zoom gate. */
  setLayer(config: LayerConfig, visible: boolean) {
    const prev = this.entries.get(config.id);
    this.entries.set(config.id, { ...prev, config, visible, ignoreGate: prev?.ignoreGate });
    this.rebuild();
  }

  /** Add or update a GeoJSON layer drawn on the GPU. */
  setGeoJson(config: LayerConfig, data: GeoJSON.FeatureCollection, visible: boolean) {
    const prev = this.entries.get(config.id);
    this.entries.set(config.id, { ...prev, config, visible, data, ignoreGate: prev?.ignoreGate });
    this.rebuild();
  }

  /** Pins (midpoint / centroid markers) for a GeoJSON layer. */
  setPins(layerId: string, pins: DeckPin[]) {
    const e = this.entries.get(layerId);
    if (!e) return;
    e.pins = pins;
    this.rebuild();
  }

  /** Which pins / point features show at the current zoom (null = all). */
  setSelection(layerId: string, pinFilter: Set<number> | null, pointFilter: Set<number> | null) {
    const e = this.entries.get(layerId);
    if (!e) return;
    e.pinFilter = pinFilter;
    e.pointFilter = pointFilter;
    this.rebuild();
  }

  /** Show the layer regardless of its minZoom (or restore the gate). */
  setGateOverride(layerId: string, ignore: boolean) {
    const e = this.entries.get(layerId);
    if (!e || !!e.ignoreGate === ignore) return;
    e.ignoreGate = ignore;
    this.rebuild();
  }

  setVisible(layerId: string, visible: boolean) {
    const e = this.entries.get(layerId);
    if (!e || e.visible === visible) return;
    e.visible = visible;
    this.rebuild();
  }

  remove(layerId: string) {
    if (this.entries.delete(layerId)) this.rebuild();
  }

  setZoom(zoom: number) {
    if (zoom === this.zoom) return;
    // Widths and gates only depend on zoom coarsely; rebuild at most every 0.1
    const coarse = Math.round(zoom * 10) !== Math.round(this.zoom * 10);
    this.zoom = zoom;
    if (coarse) this.rebuild();
  }

  /** Features from a layer (tiles currently loaded, or the whole GeoJSON). */
  getRenderedFeatures(layerId: string): GeoJSON.Feature[] {
    const e = this.entries.get(layerId);
    if (e?.data) return e.data.features;
    const l = this.live.get(layerId);
    if (!l || !(l instanceof MVTLayer)) return [];
    try {
      return (l.getRenderedFeatures() as unknown as GeoJSON.Feature[]) ?? [];
    } catch {
      return [];
    }
  }

  destroy() {
    this.overlay.setMap(null);
    this.overlay.finalize();
    this.entries.clear();
    this.live.clear();
  }

  private gated(e: Entry): boolean {
    return !e.ignoreGate && e.config.minZoom != null && this.zoom < e.config.minZoom;
  }

  private buildMvt(e: Entry): Layer {
    const { config } = e;
    const t = config.tiles!;
    const st = config.style;
    const fill = hexToRgb(st.fillColor, [173, 181, 189]);
    const stroke = hexToRgb(st.strokeColor, [13, 79, 79]);
    const fillA = Math.round((st.fillOpacity ?? 0) * 255);
    const strokeA = Math.round((st.strokeOpacity ?? 1) * 255);
    const layer = new MVTLayer({
      id: config.id,
      data: t.url,
      minZoom: t.minZoom,
      maxZoom: t.maxZoom,
      // With an extent, deck keeps requesting the lowest tile zoom when the
      // map is zoomed out past it (instead of loading nothing), so a layer
      // gate like 13.5 works even though the tiles start at z13.
      extent: TILE_EXTENT,
      loadOptions: { mvt: { layers: [t.sourceLayer] } },
      uniqueIdProperty: t.idProperty ?? 'FID',
      visible: e.visible && !this.gated(e),
      pickable: true,
      filled: fillA > 0,
      stroked: true,
      getFillColor: [fill[0], fill[1], fill[2], fillA],
      getLineColor: [stroke[0], stroke[1], stroke[2], strokeA],
      lineWidthUnits: 'pixels',
      // From zoom 17 the ground itself shows the lot lines; keep ours hairline so shore layers stay legible
      getLineWidth: this.zoom >= 17 ? Math.min(st.strokeWeight ?? 1, 1) : (st.strokeWeight ?? 1),
      lineWidthMinPixels: Math.min(st.strokeWeight ?? 1, 1),
      pointRadiusUnits: 'pixels',
      getPointRadius: 4,
    });
    this.live.set(config.id, layer);
    return layer;
  }

  private buildGeoJson(e: Entry): Layer[] {
    const { config, data } = e;
    if (!data) return [];
    const st = config.style;
    const visible = e.visible && !this.gated(e);
    const out: Layer[] = [];
    const width = strokeWeightAt(config, this.zoom);
    const sbp = config.styleByProperty;

    // Points that survive the Friends-pin spacing (null = all)
    const pf = e.pointFilter;
    const features = pf
      ? data.features.filter((f, i) => !(f.geometry?.type === 'Point' || f.geometry?.type === 'MultiPoint') || pf.has(i))
      : data.features;

    const lineColor = (f: GeoJSON.Feature): RGBA => {
      if (sbp) {
        const v = String(f.properties?.[sbp.property] ?? '');
        const o = sbp.values[v] ?? sbp.defaultStyle ?? {};
        return rgba(o.strokeColor ?? st.strokeColor, o.strokeOpacity ?? st.strokeOpacity);
      }
      return rgba(st.strokeColor, st.strokeOpacity);
    };
    const lineWidth = (f: GeoJSON.Feature): number => {
      if (sbp) {
        const v = String(f.properties?.[sbp.property] ?? '');
        const o = sbp.values[v] ?? sbp.defaultStyle ?? {};
        return o.strokeWeight ?? width;
      }
      return width;
    };
    const fillColor = (f: GeoJSON.Feature): RGBA => {
      if (sbp) {
        const v = String(f.properties?.[sbp.property] ?? '');
        const o = sbp.values[v] ?? sbp.defaultStyle ?? {};
        return rgba(o.fillColor ?? st.fillColor ?? st.strokeColor, o.fillOpacity ?? st.fillOpacity ?? 0);
      }
      return rgba(st.fillColor ?? st.strokeColor, st.fillOpacity ?? 0);
    };
    // A fully transparent fill is not pickable; renderer-drawn layers (kelp) rely on the fill as a click target
    const pickFill = config.renderer ? Math.max(3, Math.round((st.fillOpacity ?? 0) * 255)) : null;

    // Casing under the line (two-tone), or an invisible wide click target
    if (config.casing || config.hitStrokeWeight) {
      const c = config.casing;
      out.push(new GeoJsonLayer({
        id: `${config.id}__casing`,
        data: features,
        visible,
        pickable: true,
        stroked: true,
        filled: false,
        pointType: 'circle',
        getPointRadius: 0,
        lineWidthUnits: 'pixels',
        getLineWidth: c ? Math.max(c.weight, config.hitStrokeWeight ?? 0) : (config.hitStrokeWeight ?? 12),
        getLineColor: c ? rgba(c.color, c.opacity ?? 0.9) : [0, 0, 0, 1],
        lineCapRounded: true,
        lineJointRounded: true,
      }));
    }

    const icon = config.markerIcon;
    const byProp = config.markerIconByProperty;
    const scale = config.markerScale ?? 1;
    out.push(new GeoJsonLayer({
      id: config.id,
      data: features,
      visible,
      pickable: true,
      autoHighlight: !config.renderer,
      highlightColor: [255, 255, 255, 90],
      stroked: true,
      filled: (st.fillOpacity ?? 0) > 0 || pickFill != null,
      lineWidthUnits: 'pixels',
      lineWidthMinPixels: 1,
      getLineWidth: lineWidth,
      getLineColor: lineColor,
      getFillColor: pickFill != null ? (f: GeoJSON.Feature) => { const c = fillColor(f); return [c[0], c[1], c[2], Math.max(c[3], pickFill)] as RGBA; } : fillColor,
      lineCapRounded: true,
      lineJointRounded: true,
      // Point features: the layer's pin icon (buoys, pilings, projects…)
      pointType: icon ? 'icon' : 'circle',
      getIcon: icon
        ? (f: GeoJSON.Feature) => {
            const url = byProp ? (byProp.icons[String(f.properties?.[byProp.property] ?? '')] ?? icon) : icon;
            return { url, width: MARKER_W * 2, height: MARKER_H * 2, anchorY: MARKER_ANCHOR_Y * 2, mask: false };
          }
        : undefined,
      getIconSize: MARKER_H * scale,
      iconSizeUnits: 'pixels',
      iconAlphaCutoff: 0.05,
      getPointRadius: 4,
      pointRadiusUnits: 'pixels',
      updateTriggers: { getLineWidth: [width], getLineColor: [sbp?.property], getFillColor: [pickFill] },
    }));

    // Pins on lines / polygons (kelp beds, eelgrass edges, armor, docks…)
    if (e.pins?.length) {
      const pinFilter = e.pinFilter;
      const pins = pinFilter ? e.pins.filter(p => pinFilter.has(p.mid)) : e.pins;
      out.push(new IconLayer<DeckPin>({
        id: `${config.id}__pins`,
        data: pins,
        visible,
        pickable: true,
        getPosition: p => p.position,
        getIcon: p => ({ url: p.icon, width: MARKER_W * 2, height: MARKER_H * 2, anchorY: MARKER_ANCHOR_Y * 2, mask: false }),
        getSize: MARKER_H * scale,
        sizeUnits: 'pixels',
        alphaCutoff: 0.05,
      }));
    }
    for (const l of out) this.live.set(l.id, l);
    return out;
  }

  private dirty = false;

  /** Coalesce: several setters in one tick (a zoom pass touches every pin layer) rebuild once. */
  private rebuild() {
    if (this.dirty) return;
    this.dirty = true;
    queueMicrotask(() => { this.dirty = false; this.rebuildNow(); });
  }

  private rebuildNow() {
    // Draw order: tiles at the bottom, then GeoJSON layers by zIndex; pins of
    // every layer above all geometry so they are never buried under a band.
    const entries = Array.from(this.entries.values());
    const tiles = entries.filter(e => e.config.tiles).map(e => this.buildMvt(e));
    const geo = entries
      .filter(e => e.data)
      .sort((a, b) => (a.config.style.zIndex ?? 0) - (b.config.style.zIndex ?? 0))
      .map(e => this.buildGeoJson(e));
    const geometry: Layer[] = [];
    const pins: Layer[] = [];
    for (const group of geo) for (const l of group) (l.id.endsWith('__pins') ? pins : geometry).push(l);
    this.overlay.setProps({ layers: [...tiles, ...geometry, ...pins] });
  }
}

const managers = new WeakMap<google.maps.Map, DeckManager>();

/** The deck.gl manager for a map, created on first use. */
export function getDeckManager(map: google.maps.Map): DeckManager {
  let m = managers.get(map);
  if (!m) {
    m = new DeckManager(map);
    managers.set(map, m);
  }
  return m;
}

let current: DeckManager | null = null;

/** Remember the active manager so non-React code (the radius report) can reach it. */
export function registerDeckManager(m: DeckManager | null) {
  current = m;
}

export function getDeckRenderedFeatures(layerId: string): GeoJSON.Feature[] {
  return current ? current.getRenderedFeatures(layerId) : [];
}
