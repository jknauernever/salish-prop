import { useState, useEffect, useCallback, useRef } from 'react';
import type { LayerConfig, LayerState } from '../types';
import { layerConfigs } from '../config/layers';
import { fetchGeoJSON } from '../utils/geojson';
import { fetchHotspotsGeoJSON } from '../services/ebird';

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

/** Create a GeoJSON FeatureCollection of midpoints from LineString features */
function createMidpointMarkers(data: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
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
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: {},
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

function createInitialState(config: LayerConfig): LayerState {
  return {
    config,
    visible: config.visible,
    loaded: false,
    loading: false,
    error: config.placeholder ? 'Data not yet available' : null,
    featureCount: 0,
    geojsonData: null,
    dataLayer: null,
    opacity: config.defaultOpacity ?? 1,
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

export function useLayers(map: google.maps.Map | null) {
  const [layers, setLayers] = useState<LayerState[]>(() =>
    layerConfigs.map(createInitialState)
  );
  const dataLayersRef = useRef<Map<string, google.maps.Data>>(new Map());
  const markerLayersRef = useRef<Map<string, google.maps.Data>>(new Map());
  const rasterLayersRef = useRef<Map<string, google.maps.ImageMapType>>(new Map());
  const loadedRef = useRef<Set<string>>(new Set());

  // Viewport-filtered layer data: full GeoJSON + spatial index
  const viewportIndexRef = useRef<Map<string, ViewportIndex>>(new Map());
  const viewportDataRef = useRef<Map<string, GeoJSON.FeatureCollection>>(new Map());

  // Toggle non-viewport-filtered vector layer visibility via style
  const setVectorVisible = useCallback((layerId: string, visible: boolean) => {
    const config = layerConfigs.find(c => c.id === layerId);
    if (!config || config.viewportFiltered) return; // viewport layers handled separately
    const dl = dataLayersRef.current.get(layerId);
    if (!dl) return;

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
        ml.setStyle(() => ({
          icon: {
            url: config.markerIcon!,
            scaledSize: new google.maps.Size(22, 22),
            anchor: new google.maps.Point(11, 11),
          },
          clickable: false,
          visible,
        }));
      } else {
        // Point layer: use icon directly
        dl.setStyle(() => ({
          icon: {
            url: config.markerIcon!,
            scaledSize: new google.maps.Size(28, 28),
            anchor: new google.maps.Point(14, 14),
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
    } else {
      dl.setStyle({
        fillColor: config.style.fillColor,
        fillOpacity: config.style.fillOpacity,
        strokeColor: config.style.strokeColor,
        strokeWeight: config.style.strokeWeight,
        clickable: visible,
        visible,
      });
    }
  }, []);

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
          opacity: config.visible ? (config.defaultOpacity ?? 0.7) : 0,
        });

        rasterLayersRef.current.set(config.id, imageMapType);
        map.overlayMapTypes.insertAt(0, imageMapType);

        setLayers(prev => prev.map(l =>
          l.config.id === config.id
            ? { ...l, loaded: true, opacity: config.defaultOpacity ?? 0.7 }
            : l
        ));
        return;
      }

      // --- Dynamic raster layers (tile URL fetched from API) ---
      if (config.layerType === 'dynamic-raster') {
        loadedRef.current.add(config.id);
        setLayers(prev => prev.map(l =>
          l.config.id === config.id
            ? { ...l, loaded: true, opacity: config.defaultOpacity ?? 0.7 }
            : l
        ));
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

          dataLayer.setStyle(() => ({
            icon: config.markerIcon ? {
              url: config.markerIcon,
              scaledSize: new google.maps.Size(28, 28),
              anchor: new google.maps.Point(14, 14),
            } : undefined,
            clickable: true,
            visible: config.visible,
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
          const shouldShow = config.visible && aboveMinZoom;

          const hasPoints = data.features.some(f =>
            f.geometry?.type === 'Point' || f.geometry?.type === 'MultiPoint'
          );

          if (config.markerIcon && hasPoints) {
            dataLayer.setStyle(() => ({
              icon: {
                url: config.markerIcon!,
                scaledSize: new google.maps.Size(28, 28),
                anchor: new google.maps.Point(14, 14),
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
          } else {
            dataLayer.setStyle({
              fillColor: config.style.fillColor,
              fillOpacity: config.style.fillOpacity,
              strokeColor: config.style.strokeColor,
              strokeWeight: config.style.strokeWeight,
              clickable: shouldShow,
              visible: shouldShow,
            });
          }

          dataLayersRef.current.set(config.id, dataLayer);

          // For LineString layers with a markerIcon, add midpoint markers
          if (config.markerIcon) {
            const hasLines = data.features.some(f =>
              f.geometry?.type === 'LineString' || f.geometry?.type === 'MultiLineString'
            );
            if (hasLines) {
              const midpoints = createMidpointMarkers(data);
              const markerLayer = new google.maps.Data({ map });
              markerLayer.addGeoJson(midpoints);
              markerLayer.setStyle(() => ({
                icon: {
                  url: config.markerIcon!,
                  scaledSize: new google.maps.Size(22, 22),
                  anchor: new google.maps.Point(11, 11),
                },
                clickable: false,
                visible: shouldShow,
              }));
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
  }, [map, updateViewportLayers]);

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
      setLayers(prev => prev.map(layer => {
        const minZoom = layer.config.minZoom;
        if (minZoom == null) return layer;
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
  }, [map, setVectorVisible]);

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

  const setAllVisible = useCallback((category: string, visible: boolean) => {
    setLayers(prev => prev.map(layer => {
      if (layer.config.category !== category) return layer;
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

    // Trigger viewport update for any viewport-filtered layers in this category
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

  return { layers, toggleLayer, setAllVisible, setLayerOpacity, setDynamicRasterTileUrl, getDataLayer };
}
