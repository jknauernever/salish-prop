/**
 * Which features sit under (or within a few pixels of) a map click, across
 * every visible vector layer. Used by the "What's here" chooser: when a
 * shoreline carries the geology line, an armor segment, a spawning-beach
 * band and a herring polygon on top of each other, Google only reports the
 * topmost, so we look ourselves.
 *
 * Distances are in screen pixels at the current zoom (Mercator world pixels),
 * so the tolerance means the same thing at every scale. Per-feature bounding
 * boxes are cached on first use.
 */
import type { LayerState } from '../types';

export interface HitCandidate {
  layer: LayerState;
  feature: GeoJSON.Feature;
  /** 0 when the click is inside a polygon; otherwise pixels to the nearest edge / vertex. */
  distPx: number;
}

type BBox = [number, number, number, number];
const bboxCache = new WeakMap<GeoJSON.Feature, BBox>();

function bboxOf(f: GeoJSON.Feature): BBox | null {
  const c = bboxCache.get(f);
  if (c) return c;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const visit = (pos: unknown): void => {
    if (!Array.isArray(pos)) return;
    if (typeof pos[0] === 'number') {
      const [x, y] = pos as number[];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    } else for (const p of pos) visit(p);
  };
  if (!f.geometry || f.geometry.type === 'GeometryCollection') return null;
  visit((f.geometry as GeoJSON.Point).coordinates);
  if (!Number.isFinite(x0)) return null;
  const b: BBox = [x0, y0, x1, y1];
  bboxCache.set(f, b);
  return b;
}

function worldPx(lng: number, lat: number, zoom: number): [number, number] {
  const scale = 256 * Math.pow(2, zoom);
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * scale, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale];
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function ringDist(ring: number[][], px: number, py: number, zoom: number): number {
  let d = Infinity;
  let prev = worldPx(ring[0][0], ring[0][1], zoom);
  for (let i = 1; i < ring.length; i++) {
    const cur = worldPx(ring[i][0], ring[i][1], zoom);
    d = Math.min(d, segDist(px, py, prev[0], prev[1], cur[0], cur[1]));
    prev = cur;
  }
  return d;
}

function pointInRing(ring: number[][], lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function featureDist(f: GeoJSON.Feature, lng: number, lat: number, px: number, py: number, zoom: number): number {
  const g = f.geometry;
  if (!g) return Infinity;
  switch (g.type) {
    case 'Point': { const [x, y] = worldPx(g.coordinates[0], g.coordinates[1], zoom); return Math.hypot(px - x, py - y); }
    case 'MultiPoint': return Math.min(...g.coordinates.map(c => { const [x, y] = worldPx(c[0], c[1], zoom); return Math.hypot(px - x, py - y); }));
    case 'LineString': return ringDist(g.coordinates, px, py, zoom);
    case 'MultiLineString': return Math.min(...g.coordinates.map(l => ringDist(l, px, py, zoom)));
    case 'Polygon':
    case 'MultiPolygon': {
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      let d = Infinity;
      for (const rings of polys) {
        if (pointInRing(rings[0], lng, lat) && !rings.slice(1).some(h => pointInRing(h, lng, lat))) return 0;
        d = Math.min(d, ringDist(rings[0], px, py, zoom));
      }
      return d;
    }
    default: return Infinity;
  }
}

/** Pre-compute bounding boxes off the click path (called when a layer's data arrives). */
export function warmHitCache(data: GeoJSON.FeatureCollection): void {
  const run = () => { for (const f of data.features) bboxOf(f); };
  if ('requestIdleCallback' in window) (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(run);
  else setTimeout(run, 500);
}

/**
 * Features within `tolPx` of the click on every visible, loaded GeoJSON
 * layer (closest first). Layers that manage their own popups are skipped.
 */
export function featuresNear(layers: LayerState[], lat: number, lng: number, zoom: number, tolPx = 12, zoomOverrides?: ReadonlySet<string>): HitCandidate[] {
  const [px, py] = worldPx(lng, lat, zoom);
  // bbox test in degrees: tolerance converted at this latitude
  const degPerPx = 360 / (256 * Math.pow(2, zoom));
  const tolLng = tolPx * degPerPx, tolLat = tolPx * degPerPx * Math.cos((lat * Math.PI) / 180);
  const out: HitCandidate[] = [];
  for (const layer of layers) {
    const { config } = layer;
    if (!layer.visible || !layer.loaded || !layer.geojsonData) continue;
    // Switched on but not drawn at this zoom (behind its minZoom): it is not "here" as far as the person can see
    if (config.minZoom != null && zoom < config.minZoom && !zoomOverrides?.has(config.id)) continue;
    if (config.id === 'ebird-hotspots' || config.source === 'observations:multi' || config.placeholder) continue;
    for (const f of layer.geojsonData.features) {
      const b = bboxOf(f);
      if (!b) continue;
      if (lng < b[0] - tolLng || lng > b[2] + tolLng || lat < b[1] - tolLat || lat > b[3] + tolLat) continue;
      const d = featureDist(f, lng, lat, px, py, zoom);
      if (d <= tolPx) out.push({ layer, feature: f, distPx: d });
    }
  }
  return out.sort((a, b) => a.distPx - b.distPx);
}
