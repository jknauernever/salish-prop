/**
 * Server-side twin of src/services/urlState.ts — parses the same query keys
 * so the share page (api/share) and preview image (api/og) describe exactly
 * what the visitor was looking at. Underscore prefix = not a route.
 */
import { layerConfigs } from '../src/config/layers.js';
import { presets } from '../src/config/presets.js';

export interface ShareState {
  center: { lat: number; lng: number } | null;
  zoom: number | null;
  basemap: 'roadmap' | 'satellite' | 'hybrid' | 'terrain';
  /** Visible layer ids that exist in config, in config order. */
  layerIds: string[];
  /** null = URL did not specify layers (defaults apply). */
  layersSpecified: boolean;
  parcel: { lat: number; lng: number } | null;
  search: { lat: number; lng: number } | null;
}

export const DEFAULT_CENTER = { lat: 48.605, lng: -123.0 };
export const DEFAULT_ZOOM = 10.8;
export const SITE_NAME = 'Salish Sea Explorer';
export const SITE_TAGLINE = 'Protect this Place — Friends of the San Juans';

const BASEMAPS = new Set(['roadmap', 'satellite', 'hybrid', 'terrain']);

function parseLatLng(v: string | null): { lat: number; lng: number } | null {
  if (!v) return null;
  const [a, b] = v.split(',').map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: a, lng: b };
}

/**
 * @param presetName  For /view/:preset pages — when the URL carries no `l`,
 *                    the preset's layer list is the default, not the config's.
 */
export function parseShareState(sp: URLSearchParams, presetName?: string | null): ShareState {
  const center = parseLatLng(sp.get('c'));
  const z = Number(sp.get('z'));
  const zoom = Number.isFinite(z) && z >= 1 && z <= 22 ? z : null;
  const b = sp.get('b');
  const basemap = (b && BASEMAPS.has(b) ? b : 'hybrid') as ShareState['basemap'];

  const lRaw = sp.get('l');
  const known = new Set(layerConfigs.map(l => l.id));
  const preset = presetName ? presets[presetName] : undefined;
  const requested =
    lRaw === null
      ? preset
        ? new Set(preset.layers)
        : null
      : new Set(lRaw.split(',').filter(id => known.has(id)));
  const layerIds = layerConfigs
    .filter(l => (requested ? requested.has(l.id) : l.visible) && !l.placeholder)
    .map(l => l.id);

  return {
    center,
    zoom,
    basemap,
    layerIds,
    layersSpecified: lRaw !== null,
    parcel: parseLatLng(sp.get('p')),
    search: parseLatLng(sp.get('q')),
  };
}

/** Page title for a shared link: preset title when on a preset view. */
export function shareTitle(presetName: string | null | undefined, propertyView: boolean): string {
  const preset = presetName ? presets[presetName] : undefined;
  const base = preset?.meta.title ?? SITE_NAME;
  return propertyView ? `${base} — property view` : base;
}

export function layerNames(ids: string[]): string[] {
  const byId = new Map(layerConfigs.map(l => [l.id, l.name]));
  return ids.map(id => byId.get(id)).filter((n): n is string => !!n);
}

/** Human description for og:description and the image caption. */
export function describeState(st: ShareState): string {
  const names = layerNames(st.layerIds);
  const parts: string[] = [];
  if (st.parcel || st.search) parts.push('Property view');
  if (names.length === 0) parts.push('Map of the San Juan Islands');
  else if (names.length <= 4) parts.push(names.join(' · '));
  else parts.push(`${names.slice(0, 3).join(' · ')} +${names.length - 3} more`);
  return parts.join(' — ');
}
