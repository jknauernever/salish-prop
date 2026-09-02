/**
 * URL state: everything a visitor can change on the map is mirrored into the
 * query string, so copying the address bar (or the Share button) reproduces
 * the exact view for whoever opens it.
 *
 *   c   center            "48.60500,-123.00000"
 *   z   zoom              "10.8"
 *   b   basemap           roadmap | satellite | hybrid | terrain
 *   l   visible layers    "friends-bull-kelp,tax-parcels"   (l= means none)
 *   o   raster opacity    "ndvi-naip:0.5,ndvi-sentinel:0.8"
 *   m   viz mode          "opera-dist-alert:status"
 *   s   sentinel season   "ndvi-sentinel:summer-2024"
 *   d   date filter       "marbled-murrelet-obs:2025-01-01..2025-06-30"
 *   p   parcel popup      "48.53000,-123.02000"
 *   q   search center     "48.53000,-123.02000"  (draws the 1/4-mile radius)
 *   sb  sidebar open      "1"
 *
 * Writes are debounced and use history.replaceState so the back button is
 * not polluted. The server-side share endpoints (api/) parse the same keys
 * to build the Open Graph preview image.
 */

import type { DateRange } from '../types';

export interface UrlView {
  center: { lat: number; lng: number };
  zoom: number;
}

export interface UrlLayerUi {
  opacity?: number;
  vizMode?: string;
  season?: string;
  dateRange?: DateRange;
}

export interface InitialUrlState {
  view: UrlView | null;
  basemap: string | null;
  /** null = not specified in URL (use defaults / preset) */
  layers: string[] | null;
  layerUi: Record<string, UrlLayerUi>;
  parcel: { lat: number; lng: number } | null;
  search: { lat: number; lng: number } | null;
  sidebar: boolean;
  /** True when the URL carried any map state (used to skip the welcome box). */
  hasState: boolean;
}

const BASEMAPS = new Set(['roadmap', 'satellite', 'hybrid', 'terrain']);
const ID_RE = /^[a-z0-9-]+$/;

function parseLatLng(v: string | null): { lat: number; lng: number } | null {
  if (!v) return null;
  const [a, b] = v.split(',').map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: a, lng: b };
}

function parsePairs(v: string | null): [string, string][] {
  if (!v) return [];
  const out: [string, string][] = [];
  for (const item of v.split(',')) {
    const i = item.indexOf(':');
    if (i <= 0) continue;
    const id = item.slice(0, i);
    const val = item.slice(i + 1);
    if (ID_RE.test(id) && val) out.push([id, val]);
  }
  return out;
}

export function parseUrlState(queryString: string): InitialUrlState {
  const sp = new URLSearchParams(queryString);

  const center = parseLatLng(sp.get('c'));
  const zoomRaw = Number(sp.get('z'));
  const zoom = Number.isFinite(zoomRaw) && zoomRaw >= 1 && zoomRaw <= 22 ? zoomRaw : null;
  const view = center && zoom !== null ? { center, zoom } : null;

  const b = sp.get('b');
  const basemap = b && BASEMAPS.has(b) ? b : null;

  const lRaw = sp.get('l');
  const layers = lRaw === null ? null : lRaw.split(',').filter(id => ID_RE.test(id));

  const layerUi: Record<string, UrlLayerUi> = {};
  const ui = (id: string) => (layerUi[id] ??= {});
  for (const [id, v] of parsePairs(sp.get('o'))) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0 && n <= 1) ui(id).opacity = n;
  }
  for (const [id, v] of parsePairs(sp.get('m'))) {
    if (ID_RE.test(v)) ui(id).vizMode = v;
  }
  for (const [id, v] of parsePairs(sp.get('s'))) {
    if (ID_RE.test(v)) ui(id).season = v;
  }
  for (const [id, v] of parsePairs(sp.get('d'))) {
    const [start, end] = v.split('..');
    const ok = (x: string | undefined) => !x || /^\d{4}-\d{2}-\d{2}$/.test(x);
    if (ok(start) && ok(end)) ui(id).dateRange = { start: start || null, end: end || null };
  }

  const parcel = parseLatLng(sp.get('p'));
  const search = parseLatLng(sp.get('q'));
  const sidebar = sp.get('sb') === '1';

  const hasState = view !== null || layers !== null || parcel !== null || search !== null;

  return { view, basemap, layers, layerUi, parcel, search, sidebar, hasState };
}

/** Parsed once at module load — the state the page was opened with. */
export const initialUrlState: InitialUrlState =
  typeof window === 'undefined'
    ? { view: null, basemap: null, layers: null, layerUi: {}, parcel: null, search: null, sidebar: false, hasState: false }
    : parseUrlState(window.location.search);

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

const current: Map<string, string> = new Map();
if (typeof window !== 'undefined') {
  // Seed with whatever is already there so unrelated params survive.
  new URLSearchParams(window.location.search).forEach((v, k) => current.set(k, v));
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  flushTimer = null;
  if (typeof window === 'undefined') return;
  const sp = new URLSearchParams();
  for (const [k, v] of current) sp.set(k, v);
  const qs = sp.toString();
  const next = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
  const now = window.location.pathname + window.location.search + window.location.hash;
  if (next !== now) window.history.replaceState(window.history.state, '', next);
}

/**
 * Merge params into the URL. `null`/`undefined`/'' removes the key.
 * Debounced so map pans and slider drags don't hammer replaceState.
 */
export function setUrlParams(patch: Record<string, string | null | undefined>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') current.delete(k);
    else current.set(k, v);
  }
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 250);
}

/** The shareable URL for the current state (flushes pending writes first). */
export function getShareUrl(): string {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flush();
  }
  return window.location.href;
}

export function fmtLatLng(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

/** "id:value,id:value" — omits entries whose value is empty. */
export function fmtPairs(pairs: [string, string | null | undefined][]): string {
  return pairs.filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(',');
}
