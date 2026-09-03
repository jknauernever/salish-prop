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

function inZoomRange(layer: LayerState, zoom: number): boolean {
  const { minZoom } = layer.config;
  return minZoom == null || zoom >= minZoom;
}

/**
 * Which visible layers actually have something drawn inside the current map
 * frame. Recomputed when the map goes idle after a pan/zoom and whenever the
 * layer list changes (toggle, load). Raster layers count as in view whenever
 * they are on and inside their zoom range; vector layers need at least one
 * feature whose bounds intersect the viewport.
 */
export function useLayersInView(map: google.maps.Map | null, layers: LayerState[]): Set<string> {
  const [inView, setInView] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!map) return;

    const compute = () => {
      const view = map.getBounds();
      const zoom = map.getZoom() ?? 0;
      const next = new Set<string>();
      if (view) {
        for (const layer of layers) {
          if (!layer.visible || layer.config.placeholder || !inZoomRange(layer, zoom)) continue;
          const t = layer.config.layerType;
          if (t === 'raster' || t === 'dynamic-raster' || layer.config.tiles) {
            next.add(layer.config.id);
            continue;
          }
          if (layer.loaded && layer.dataLayer && dataLayerHasFeatureIn(layer.dataLayer, view)) {
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
  }, [map, layers]);

  return inView;
}
