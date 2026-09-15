import { useEffect, useState } from 'react';
import type { LayerState } from '../types';

/** Per-feature bounds, computed once per Data feature and reused on every idle. */
const boundsCache = new WeakMap<google.maps.Data.Feature, google.maps.LatLngBounds | null>();

function featureBounds(feature: google.maps.Data.Feature): google.maps.LatLngBounds | null {
  const cached = boundsCache.get(feature);
  if (cached !== undefined) return cached;
  const geom = feature.getGeometry();
  let b: google.maps.LatLngBounds | null = null;
  if (geom) {
    b = new google.maps.LatLngBounds();
    geom.forEachLatLng(ll => b!.extend(ll));
  }
  boundsCache.set(feature, b);
  return b;
}

/** True when at least one feature of the Data layer intersects the viewport. */
function dataLayerHasFeatureIn(dataLayer: google.maps.Data, view: google.maps.LatLngBounds): boolean {
  let hit = false;
  // Data.forEach has no early exit; the intersection test is a few float
  // comparisons per feature once bounds are cached, so a full pass is cheap.
  dataLayer.forEach(f => {
    if (hit) return;
    const b = featureBounds(f);
    if (b && view.intersects(b)) hit = true;
  });
  return hit;
}

/** GPU layers have no Data layer: test the GeoJSON's cached feature bboxes instead. */
const geoBounds = new WeakMap<GeoJSON.Feature, [number, number, number, number] | null>();
function geojsonHasFeatureIn(data: GeoJSON.FeatureCollection, view: google.maps.LatLngBounds): boolean {
  const sw = view.getSouthWest(), ne = view.getNorthEast();
  const w = sw.lng(), s = sw.lat(), e = ne.lng(), n = ne.lat();
  for (const f of data.features) {
    let b = geoBounds.get(f);
    if (b === undefined) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const visit = (pos: unknown): void => {
        if (!Array.isArray(pos)) return;
        if (typeof pos[0] === 'number') { const [x, y] = pos as number[]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        else for (const p of pos) visit(p);
      };
      if (f.geometry && f.geometry.type !== 'GeometryCollection') visit((f.geometry as GeoJSON.Point).coordinates);
      b = Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
      geoBounds.set(f, b);
    }
    if (b && b[0] <= e && b[2] >= w && b[1] <= n && b[3] >= s) return true;
  }
  return false;
}

function inZoomRange(layer: LayerState, zoom: number, overrides: Set<string>): boolean {
  const { minZoom } = layer.config;
  return minZoom == null || zoom >= minZoom || overrides.has(layer.config.id);
}

/**
 * Which visible layers actually have something drawn inside the current map
 * frame. Recomputed when the map goes idle after a pan/zoom and whenever the
 * layer list changes (toggle, load). Raster layers count as in view whenever
 * they are on and inside their zoom range; vector layers need at least one
 * feature whose bounds intersect the viewport.
 */
export function useLayersInView(map: google.maps.Map | null, layers: LayerState[], zoomOverrides: Set<string> = new Set()): Set<string> {
  const [inView, setInView] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!map) return;

    const compute = () => {
      const view = map.getBounds();
      const zoom = map.getZoom() ?? 0;
      const next = new Set<string>();
      if (view) {
        for (const layer of layers) {
          if (!layer.visible || layer.config.placeholder || !inZoomRange(layer, zoom, zoomOverrides)) continue;
          const t = layer.config.layerType;
          if (t === 'raster' || t === 'dynamic-raster' || layer.config.tiles) {
            next.add(layer.config.id);
            continue;
          }
          if (layer.loaded && layer.dataLayer && dataLayerHasFeatureIn(layer.dataLayer, view)) {
            next.add(layer.config.id);
          } else if (layer.loaded && !layer.dataLayer && layer.geojsonData && geojsonHasFeatureIn(layer.geojsonData, view)) {
            next.add(layer.config.id);
          }
        }
      }
      setInView(prev => {
        if (prev.size === next.size && [...next].every(id => prev.has(id))) return prev;
        return next;
      });
    };

    // Viewport-filtered layers repopulate their Data layer on idle too; run
    // after them by deferring to the next tick.
    const onIdle = () => setTimeout(compute, 0);
    const listener = map.addListener('idle', onIdle);
    onIdle();
    return () => google.maps.event.removeListener(listener);
  }, [map, layers, zoomOverrides]);

  return inView;
}
