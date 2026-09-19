/**
 * Fish use (Beamer & Fresh 2012): one standard for all seven species layers.
 *
 * Every shoreline segment in /data/fish-use.geojson carries a high-resolution
 * model score (HRM_<code>, 0–1) for each species. Friends presents those as
 * three priority levels — moderate / high / highest — using the bins from the
 * countywide salmon recovery prioritization (Tina Whitman, Sept 2026). Nothing
 * is ranked "low": fish can and do use every shoreline.
 *
 * Fish Use is ONE layer with a "Color by" choice (the layer's vizMode): a
 * species, or the highest level among all seven. The line takes its color and
 * width from that choice (DeckLayers → buildFishUse); the hover label and the
 * popup always list every species, the chosen one first.
 */
import type { CategoryLegend, LayerState, PopupField } from '../types';

export const FISH_USE_LAYER_ID = 'fish-use';
export const FISH_USE_SOURCE = '/data/fish-use.geojson';
/** Public name. "Fish use" is Friends' planning term for this data (2017 salmon recovery prioritization). */
export const FISH_USE_NAME = 'Priority Shorelines for Fish';
/** Color-by mode that ranks each segment by its highest level among all seven species. */
export const FISH_MODE_ALL = 'all';

export type FishTier = 1 | 2 | 3;

export interface FishTierSpec {
  tier: FishTier;
  label: string;
  short: string;
  color: string;
  /** Text color that reads on `color` (pills). */
  text: string;
  /** Line width in px: priority is carried by width as well as color. */
  weight: number;
}

export const FISH_TIERS: Record<FishTier, FishTierSpec> = {
  1: { tier: 1, label: 'Moderate priority', short: 'Moderate', color: '#FCD34D', text: '#5B4300', weight: 4 },
  2: { tier: 2, label: 'High priority', short: 'High', color: '#F97316', text: '#FFFFFF', weight: 5 },
  3: { tier: 3, label: 'Highest priority', short: 'Highest', color: '#B91C1C', text: '#FFFFFF', weight: 6 },
};

export interface FishSpecies {
  /** Color-by mode id (the layer's vizMode; also what share links carry). */
  mode: string;
  /** Id of the separate per-species layer this replaced; old share links still name it. */
  legacyLayerId: string;
  /** Column suffix in the data: HRM_<code>. */
  code: string;
  /** Display name, as Friends writes it. */
  name: string;
  /** Upper bound (inclusive) of the moderate bin. */
  moderateMax: number;
  /** Upper bound (inclusive) of the high bin; anything above is highest. */
  highMax: number;
}

export const FISH_SPECIES: FishSpecies[] = [
  { mode: 'chinook', legacyLayerId: 'chinook-salmon', code: 'Ck', name: 'Juvenile Chinook', moderateMax: 0.084656, highMax: 0.214912 },
  { mode: 'chum', legacyLayerId: 'chum-salmon', code: 'Chum', name: 'Juvenile Chum', moderateMax: 0.323232, highMax: 0.611842 },
  { mode: 'pink', legacyLayerId: 'pink-salmon', code: 'Pk', name: 'Juvenile Pink', moderateMax: 0.300752, highMax: 0.477273 },
  { mode: 'herring', legacyLayerId: 'pacific-herring', code: 'Herr', name: 'Pacific herring', moderateMax: 0.0888889, highMax: 0.208333 },
  { mode: 'smelt', legacyLayerId: 'surf-smelt', code: 'Smelt', name: 'Surf smelt', moderateMax: 0.073333, highMax: 0.2 },
  { mode: 'sand-lance', legacyLayerId: 'pacific-sand-lance', code: 'Lance', name: 'Pacific sand lance', moderateMax: 0.113636, highMax: 0.27778 },
  { mode: 'greenlings', legacyLayerId: 'lingcod-greenling', code: 'Hex', name: 'Greenlings and Cods', moderateMax: 0.357955, highMax: 0.614035 },
];

const BY_MODE = new Map(FISH_SPECIES.map(s => [s.mode, s]));
const BY_CODE = new Map(FISH_SPECIES.map(s => [s.code, s]));

export const fishSpeciesForCode = (code: string): FishSpecies | undefined => BY_CODE.get(code);

/** The layer's "Color by" choices; the first is the default. */
export const FISH_COLOR_MODES: { id: string; label: string }[] = [
  ...FISH_SPECIES.map(s => ({ id: s.mode, label: s.name })),
  { id: FISH_MODE_ALL, label: 'Highest of all seven species' },
];

/** Species codes that set the line's color for a Color-by mode (unknown / unset = the default species). */
export function fishCodesForMode(mode: string | undefined): string[] {
  if (mode === FISH_MODE_ALL) return FISH_SPECIES.map(s => s.code);
  return [(BY_MODE.get(mode ?? '') ?? FISH_SPECIES[0]).code];
}

/**
 * Old share links name the per-species layers ("l=chinook-salmon,pink-salmon").
 * Returns the Color-by mode they translate to: that species, or "all" for several.
 */
export function fishModeForLegacyLayers(layerIds: string[]): string | null {
  const hit = FISH_SPECIES.filter(s => layerIds.includes(s.legacyLayerId));
  if (!hit.length) return null;
  return hit.length === 1 ? hit[0].mode : FISH_MODE_ALL;
}
export const isLegacyFishLayerId = (id: string): boolean => FISH_SPECIES.some(s => s.legacyLayerId === id);

/** Priority level for a score. Scores of 0 are moderate: nothing is ranked low. */
export function fishTier(sp: FishSpecies, hrm: number): FishTier {
  // The bins end exactly on values that occur in the data (written to 6 decimals), hence the tolerance
  const EPS = 5e-6;
  if (hrm > sp.highMax + EPS) return 3;
  if (hrm > sp.moderateMax + EPS) return 2;
  return 1;
}

export interface FishUseEntry {
  species: FishSpecies;
  hrm: number;
  tier: FishTier;
}

/** Every species' level on a segment, highest first (ties keep the standard species order). */
export function fishUseEntries(props: Record<string, unknown> | null | undefined, codes?: Iterable<string>): FishUseEntry[] {
  const only = codes ? new Set(codes) : null;
  const out: FishUseEntry[] = [];
  for (const sp of FISH_SPECIES) {
    if (only && !only.has(sp.code)) continue;
    const raw = props?.[`HRM_${sp.code}`];
    if (raw == null || raw === '') continue;
    const hrm = Number(raw);
    if (!Number.isFinite(hrm)) continue;
    out.push({ species: sp, hrm, tier: fishTier(sp, hrm) });
  }
  return out.sort((a, b) => b.tier - a.tier);
}

/** Species codes the Fish Use line is colored by right now (empty when the layer is off). */
export function visibleFishCodes(layers: LayerState[]): string[] {
  const l = layers.find(x => x.config.fishUse);
  return l?.visible ? fishCodesForMode(l.vizMode) : [];
}

export const FISH_USE_LEGEND: CategoryLegend = {
  type: 'categories',
  items: ([1, 2, 3] as FishTier[]).map(t => ({ label: FISH_TIERS[t].label, color: FISH_TIERS[t].color, shape: 'line' as const })),
};

/** Popup detail rows: the shoreline's name and type first, then each species' model score by name. */
export const FISH_USE_POPUP_FIELDS: PopupField[] = [
  { key: 'Name', label: 'Location' },
  { key: 'GeoUnit', label: 'Geomorphic Unit' },
  { key: 'RITT_SysTy', label: 'System Type' },
  { key: 'RITT_SubTy', label: 'Sub Type' },
  ...FISH_SPECIES.map(s => ({ key: `HRM_${s.code}`, label: `${s.name}: fish use score (high-resolution model)` })),
];

// ---------------------------------------------------------------------------
// The fish mark: one generic silhouette for every species (identity comes from
// the name beside it; color is reserved for the priority level).
// ---------------------------------------------------------------------------

const FISH_PATH = 'M1.5 12C4.6 7.4 8.8 5.6 12.6 5.6c3 0 5.6 1.2 7.4 3.5L23 6.2v11.6l-3-2.9c-1.8 2.3-4.4 3.5-7.4 3.5-3.8 0-8-1.8-11.1-6.4zM7.6 9.7a1.15 1.15 0 100 2.3 1.15 1.15 0 000-2.3z';

export function fishIconSvg(size = 16, color = '#0D4F4F'): string {
  const h = Math.round(size * 0.75);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${h}" viewBox="0 3 24 18" aria-hidden="true"><path fill="${color}" fill-rule="evenodd" d="${FISH_PATH}"/></svg>`;
}

export const FISH_ICON_URL = `data:image/svg+xml;utf8,${encodeURIComponent(fishIconSvg(24))}`;

// ---------------------------------------------------------------------------
// HTML fragments shared by the hover label, the chooser and the popups
// ---------------------------------------------------------------------------

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function fishTierPill(tier: FishTier): string {
  const t = FISH_TIERS[tier];
  return `<span style="display:inline-block;padding:1px 8px;border-radius:999px;background:${t.color};color:${t.text};font-size:12px;font-weight:700;line-height:1.5;white-space:nowrap;">${t.label}</span>`;
}

const dot = (tier: FishTier): string =>
  `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${FISH_TIERS[tier].color};box-shadow:0 0 0 1px rgba(0,0,0,.25);flex-shrink:0;"></span>`;

/**
 * Compact lines for the hover label and chooser row: "● Juvenile Chinook · Highest priority".
 * With `emphasize` (codes of the species the line is colored by) those come
 * first at full strength and the rest follow, quieter: the shoreline matters to all seven.
 */
export function fishUseLinesHtml(entries: FishUseEntry[], mark: 'dot' | 'fish' = 'dot', emphasize?: Iterable<string>): string {
  const on = emphasize ? new Set(emphasize) : null;
  const ordered = on ? [...entries.filter(e => on.has(e.species.code)), ...entries.filter(e => !on.has(e.species.code))] : entries;
  return ordered.map(e => {
    const quiet = !!on && !on.has(e.species.code);
    return `<span style="display:flex;align-items:center;gap:6px;${mark === 'fish' ? 'white-space:nowrap;' : 'font-size:13px;'}${quiet ? 'opacity:.7;font-weight:400;' : ''}">${mark === 'fish' ? `<span style="line-height:0;flex-shrink:0;">${fishIconSvg(15, FISH_TIERS[e.tier].color)}</span>` : dot(e.tier)}<span><strong style="font-weight:${quiet ? 500 : 600};">${esc(e.species.name)}</strong> · ${FISH_TIERS[e.tier].label}</span></span>`;
  }).join('');
}

/**
 * The species list for popups: fish mark, name, priority pill — highest first.
 * `emphasize` (codes the line is colored by) get full strength; the rest
 * are listed under them, quieter, so the popup still answers "what about the
 * other species here?".
 */
export function fishUseListHtml(entries: FishUseEntry[], emphasize?: Iterable<string>): string {
  const on = emphasize ? new Set(emphasize) : null;
  const row = (e: FishUseEntry, quiet: boolean) => `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(0,0,0,.06);${quiet ? 'opacity:.72;' : ''}">
      <span style="flex-shrink:0;line-height:0;">${fishIconSvg(18, quiet ? '#64748B' : '#0D4F4F')}</span>
      <span style="flex:1;min-width:0;font-size:14px;color:#1E293B;${quiet ? '' : 'font-weight:600;'}">${esc(e.species.name)}</span>
      ${fishTierPill(e.tier)}
    </div>`;
  if (!on || on.size === 0) return entries.map(e => row(e, false)).join('');
  const lead = entries.filter(e => on.has(e.species.code));
  const rest = entries.filter(e => !on.has(e.species.code));
  const restHead = rest.length
    ? `<div style="margin:10px 0 2px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#64748B;">Other species on this shoreline</div>`
    : '';
  return lead.map(e => row(e, false)).join('') + restHead + rest.map(e => row(e, true)).join('');
}
