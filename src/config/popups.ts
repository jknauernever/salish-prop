/**
 * Per-layer popup content: which fields become the title, the three key
 * facts, the chips, the story and action blocks, and which photo stands in
 * until the feature has one of its own. Layers without an entry here fall
 * back to a title from the best name field, all fields in the table, and
 * the layer's own description and source credit.
 *
 * Keep this data-only: every function is a pure mapping from feature
 * properties to display strings.
 */

import type { LayerConfig } from '../types';
import type { PopupBlock, PopupChip, PopupPhoto, PopupStat } from '../components/Map/popupFrame';
import { SHOREFORM_TYPES, shoreformLabel } from './shoreforms';

type Props = Record<string, unknown>;

export interface PopupSpec {
  title?: (p: Props) => string | undefined;
  subtitle?: (p: Props) => string | undefined;
  stats?: (p: Props) => PopupStat[];
  chips?: (p: Props) => PopupChip[];
  /** Overrides the layer's standardMessage as the story block. */
  story?: (p: Props) => PopupBlock | undefined;
  action?: PopupBlock;
  /** A link carried by the feature itself, shown as the footer's primary button. */
  link?: (p: Props) => { label: string; href: string } | undefined;
  /** Feature-level photos (observations, future admin uploads). */
  photos?: (p: Props) => PopupPhoto[];
  /** Skip the all-details table (layers whose fields are all shown as facts). */
  noDetails?: boolean;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const str = (v: unknown): string => (v == null ? '' : String(v).trim());
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseFloat(str(v));
  return Number.isFinite(n) ? n : null;
};

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** Feet as "1,240 ft" or "2.3 mi" when over a mile. */
export function fmtFeet(ft: number): PopupStat {
  if (ft >= 5280) return { value: (ft / 5280).toFixed(ft >= 52800 ? 0 : 1), unit: 'mi', label: '' };
  return { value: fmtInt(ft), unit: 'ft', label: '' };
}

/** Square feet as acres, with sensible precision. */
export function sqftToAcres(sqft: number): string {
  const ac = sqft / 43560;
  if (ac >= 100) return fmtInt(ac);
  if (ac >= 10) return ac.toFixed(1);
  return ac.toFixed(2);
}

export function fmtAcresValue(ac: number): string {
  if (ac >= 100) return fmtInt(ac);
  if (ac >= 10) return ac.toFixed(1);
  return ac.toFixed(2);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "8/8/2001", "2019-05-02T17:09:56Z", or epoch ms → "Aug 2001". */
export function fmtMonthYear(v: unknown): string {
  const s = str(v);
  if (!s) return '';
  const d = typeof v === 'number' ? new Date(v) : new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtYear(v: unknown): string {
  const s = str(v);
  if (/^\d{4}$/.test(s)) return s;
  const d = typeof v === 'number' ? new Date(v) : new Date(s);
  return Number.isNaN(d.getTime()) ? s : String(d.getFullYear());
}

const HML: Record<string, string> = { H: 'high', M: 'medium', L: 'low' };
const YN = (v: unknown): boolean | null => {
  const s = str(v).toUpperCase();
  if (s === 'Y' || s === 'YES' || s === '1' || s === 'TRUE') return true;
  if (s === 'N' || s === 'NO' || s === '0' || s === 'FALSE') return false;
  return null;
};

const MATERIAL: Record<string, string> = { W: 'Wood', C: 'Concrete', R: 'Rock', S: 'Steel', P: 'Plastic', M: 'Metal', F: 'Fiberglass', O: 'Other' };
const CONDITION: Record<string, string> = { G: 'Good', F: 'Fair', P: 'Poor', E: 'Excellent' };
const BUOY_TYPE: Record<string, string> = { B: 'Mooring buoy', F: 'Float', R: 'Raft' };

// ---------------------------------------------------------------------------
// Photos: the shoreline handout's images stand in until features have their own
// ---------------------------------------------------------------------------

const IMG = '/reports/shoreline-images';
const FRIENDS = 'Friends of the San Juans';

export const LAYER_PHOTOS: Record<string, PopupPhoto> = {
  'friends-bull-kelp': { url: `${IMG}/kelp.jpg`, caption: 'Bull kelp canopy at the surface', credit: FRIENDS },
  'friends-deepwater-eelgrass': { url: `${IMG}/eelgrass.jpg`, caption: 'Eelgrass meadow at low tide', credit: FRIENDS },
  'friends-herring-spawning': { url: `${IMG}/eelgrass.jpg`, caption: 'Eelgrass, where herring lay their eggs', credit: FRIENDS },
  'friends-documented-forage-spawning': { url: `${IMG}/forage-fish.jpg`, caption: 'Forage fish spawning beach', credit: FRIENDS },
  'friends-potential-forage-spawning': { url: `${IMG}/forage-fish.jpg`, caption: 'Sand and pea-gravel beach, the substrate forage fish need', credit: FRIENDS },
  'friends-shoreline-geology': { url: `${IMG}/feeder-bluffs.jpg`, caption: 'A feeder bluff supplying the beaches downdrift', credit: FRIENDS },
  'friends-armor': { url: `${IMG}/adapt-fortify.jpg`, caption: 'Hard armoring along the shore', credit: FRIENDS },
  'friends-armor-2019': { url: `${IMG}/adapt-fortify.jpg`, caption: 'Hard armoring along the shore', credit: FRIENDS },
  'friends-armor-change-2019': { url: `${IMG}/erosion-after.jpg`, caption: 'Shoreline after armor removal', credit: FRIENDS },
  'friends-projects': { url: `${IMG}/restoration-after.jpg`, caption: 'Restored beach and marsh', credit: FRIENDS },
  'friends-docks': { url: `${IMG}/preserve.jpg`, caption: 'Shoreline with a dock', credit: FRIENDS },
  'friends-mooring-buoys': { url: `${IMG}/clean-water.jpg`, caption: 'Nearshore waters', credit: FRIENDS },
  'friends-groins': { url: `${IMG}/erosion-before.jpg`, caption: 'Armored shoreline', credit: FRIENDS },
  'friends-boat-ramps': { url: `${IMG}/preserve.jpg`, caption: 'Shoreline access', credit: FRIENDS },
  'friends-marine-railway': { url: `${IMG}/preserve.jpg`, caption: 'Shoreline access', credit: FRIENDS },
  'friends-pilings': { url: `${IMG}/preserve.jpg`, caption: 'In-water structures', credit: FRIENDS },
  'forest-loss': { url: `${IMG}/trees.jpg`, caption: 'Shoreline forest', credit: FRIENDS },
  'opera-dist-alert': { url: `${IMG}/trees.jpg`, caption: 'Shoreline forest', credit: FRIENDS },
  'shoreline-types': { url: `${IMG}/feeder-bluffs.jpg`, caption: 'Feeder bluff', credit: FRIENDS },
  'eelgrass': { url: `${IMG}/eelgrass.jpg`, caption: 'Eelgrass meadow at low tide', credit: FRIENDS },
  'stormwater-pipes': { url: `${IMG}/clean-water.jpg`, caption: 'Runoff reaches the shore', credit: FRIENDS },
};

/** What a photo's caption must mention to illustrate a layer (see photosForSubject). */
export const PHOTO_SUBJECTS: Record<string, RegExp> = {
  'friends-deepwater-eelgrass': /eelgrass|seagrass/i,
  'eelgrass': /eelgrass|seagrass/i,
  'friends-bull-kelp': /\bkelp\b/i,
  'friends-herring-spawning': /herring/i,
  'pacific-herring': /herring/i,
  'friends-documented-forage-spawning': /forage fish|sand lance|smelt|spawn/i,
  'friends-potential-forage-spawning': /forage fish|sand lance|smelt|spawn/i,
  'pacific-sand-lance': /sand lance|forage fish/i,
  'surf-smelt': /smelt|forage fish/i,
  'chinook-salmon': /salmon/i,
  'chum-salmon': /salmon/i,
  'pink-salmon': /salmon/i,
  'friends-shoreline-geology': /bluff|beach|shoreline/i,
  'friends-armor': /armor|bulkhead|riprap|seawall|rock/i,
  'friends-armor-2019': /armor|bulkhead|riprap|seawall|rock/i,
  'friends-armor-change-2019': /armor|bulkhead|riprap|seawall|rock/i,
  'friends-docks': /\bdock\b|\bpier\b/i,
  'friends-pilings': /piling|creosote/i,
  'friends-mooring-buoys': /buoy|mooring/i,
  'marbled-murrelet-observations': /murrelet/i,
  'marbled-murrelet-breeding': /murrelet/i,
  'marbled-murrelet-winter': /murrelet/i,
};

/** Captions that are about something other than the habitat even when they name it. */
export const PHOTO_EXCLUDE = /sculpture|tile|mural|art\b|canoe|kayak|ship|tanker|vessel|marina|\bboat\b|logo|map\b|graph|chart|sign\b|poster/i;

// ---------------------------------------------------------------------------
// Action blocks: what Friends would like done, keyed to what was clicked
// ---------------------------------------------------------------------------

const GUIDE = '/reports/living-with-the-shoreline.html';
const KELP_REPORT = '/reports/kelp-habitat-value-and-threats.html';

const ACTIONS = {
  onTheWater: {
    kicker: 'On the water here',
    html: 'Anchor outside kelp and eelgrass, slow down near beds, and plan in-water work outside the spawning window.',
    button: { label: 'Living with the shoreline', href: GUIDE },
  },
  kelp: {
    kicker: 'On the water here',
    html: 'Steer and anchor clear of the canopy, and keep runoff and sediment from reaching the water.',
    button: { label: 'Why kelp matters', href: KELP_REPORT },
  },
  beach: {
    kicker: 'If this is your beach',
    html: 'Keep the drift log line, skip new bulkheads and fill, and time beach work outside spawning season.',
    button: { label: 'Beach-friendly practices', href: GUIDE },
  },
  shoreline: {
    kicker: 'If this is your shoreline',
    html: 'Ask about a shore-friendly stabilization site visit before adding or replacing armor.',
    button: { label: 'Living with the shoreline', href: GUIDE },
  },
  structure: {
    kicker: 'If this is yours',
    html: 'Grated decking, no creosote, and floats that stay off the bottom keep light and habitat under the structure.',
    button: { label: 'Living with the shoreline', href: GUIDE },
  },
} satisfies Record<string, PopupBlock>;

// ---------------------------------------------------------------------------
// Per-layer specs
// ---------------------------------------------------------------------------

const island = (p: Props): string => {
  const i = str(p.ISLAND ?? p.Island ?? p.island);
  return i ? `${i} Island` : '';
};
const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ');

const shapeLengthStat = (p: Props, label: string): PopupStat[] => {
  const ft = num(p.Shape_Length ?? p.SHAPE_Leng ?? p.LENGTH);
  return ft && ft > 0 ? [{ ...fmtFeet(ft), label }] : [];
};

const structureSpec = (noun: string, timeKey: string): PopupSpec => ({
  title: () => noun,
  subtitle: p => join(island(p), fmtMonthYear(p[timeKey]) ? `surveyed ${fmtMonthYear(p[timeKey])}` : undefined),
  action: ACTIONS.structure,
});

export const POPUP_SPECS: Record<string, PopupSpec> = {
  'friends-bull-kelp': {
    title: () => 'Bull kelp bed',
    subtitle: () => 'Merged canopy patch',
    stats: p => {
      const ac = num(p.acres);
      return [
        ...(ac != null ? [{ value: fmtAcresValue(ac), unit: 'ac', label: 'Canopy area' }] : []),
        { value: '2007', label: 'Survey year' },
      ];
    },
    chips: () => [{ label: 'Boundaries approximate', tone: 'warn' }, { label: 'WDFW priority habitat', tone: 'teal' }],
    action: ACTIONS.kelp,
    noDetails: true,
  },

  'friends-deepwater-eelgrass': {
    title: () => 'Deep-water edge of eelgrass',
    subtitle: p => join(island(p), str(p.SITECODE) ? `site ${str(p.SITECODE)}` : undefined),
    stats: p => {
      const len = num(p.LENGTH);
      const n = num(p.SAMP_SIZE);
      return [
        ...(len ? [{ ...fmtFeet(len), label: 'Edge length' }] : []),
        ...(n ? [{ value: fmtInt(n), label: 'Samples' }] : []),
        { value: '2004', label: 'Survey year' },
      ];
    },
    action: ACTIONS.onTheWater,
  },

  'friends-herring-spawning': {
    title: p => str(p.Name) || 'Herring spawning ground',
    subtitle: () => 'Pacific herring spawning ground · present or historic',
    stats: p => {
      const area = num(p.Shape_Area);
      return [
        ...(area ? [{ value: sqftToAcres(area), unit: 'ac', label: 'Area' }] : []),
        ...shapeLengthStat(p, 'Perimeter'),
        { value: '2004', label: 'WDFW mapping' },
      ];
    },
    action: ACTIONS.onTheWater,
    noDetails: true,
  },

  'friends-documented-forage-spawning': {
    title: p => join(str(p.NAME_2) || str(p.NAME) || 'Spawning beach', str(p.C_Type_FOSJ)),
    subtitle: p => join(island(p), str(p.ShoreForm_Unit_ID) ? `shoreform unit ${str(p.ShoreForm_Unit_ID)}` : undefined),
    stats: p => {
      const species = str(p.SPECIES).replace(/([a-z])([A-Z])/g, '$1 $2');
      const eggs = num(p.EggCount);
      return [
        ...(species ? [{ value: species, label: 'Species' }] : []),
        ...(eggs != null ? [{ value: fmtInt(eggs), label: 'Eggs / sample' }] : []),
        ...(fmtMonthYear(p.DATE_) ? [{ value: fmtMonthYear(p.DATE_), label: 'Surveyed' }] : []),
      ];
    },
    action: ACTIONS.beach,
  },

  'friends-potential-forage-spawning': {
    title: () => 'Potential spawning beach',
    subtitle: p => join(str(p.C_Type_FOSJ) ? `beach type ${str(p.C_Type_FOSJ)}` : undefined, str(p.ShoreForm_Unit_ID) ? `shoreform unit ${str(p.ShoreForm_Unit_ID)}` : undefined),
    stats: p => shapeLengthStat(p, 'Beach length'),
    action: ACTIONS.beach,
  },

  'friends-shoreline-geology': {
    title: p => shoreformLabel(str(p.PIAT_shoreforms)) || 'Shoreline unit',
    subtitle: p => join(str(p.ShoreForm_Unit_ID) ? `unit ${str(p.ShoreForm_Unit_ID)}` : undefined, (() => { const ft = num(p.Shape_Length); return ft ? `${fmtFeet(ft).value} ${fmtFeet(ft).unit}` : undefined; })()),
    chips: p => {
      const chips: PopupChip[] = [];
      const r = HML[str(p.PIATrestoration).toUpperCase()];
      if (r) chips.push({ label: `Restoration priority: ${r}`, tone: r === 'high' ? 'warn' : 'default' });
      const pr = HML[str(p.PIATprotection).toUpperCase()];
      if (pr) chips.push({ label: `Protection priority: ${pr}`, tone: pr === 'high' ? 'teal' : 'default' });
      const fu = HML[str(p.FISHuse_SF).toUpperCase()];
      if (fu) chips.push({ label: `Fish use: ${fu}` });
      const ff = YN(p.FFhab);
      if (ff != null) chips.push({ label: ff ? 'Forage fish habitat' : 'Not forage fish habitat', tone: ff ? 'on' : 'default' });
      return chips;
    },
    story: p => {
      const t = SHOREFORM_TYPES[str(p.PIAT_shoreforms)];
      return t ? { kicker: t.label, html: t.description } : undefined;
    },
    action: ACTIONS.shoreline,
  },

  'friends-armor': {
    title: () => 'Shoreline armor',
    subtitle: p => join(island(p), fmtYear(p.DateTimeS) ? `surveyed ${fmtYear(p.DateTimeS)}` : undefined),
    action: ACTIONS.shoreline,
  },
  'friends-armor-2019': {
    title: () => 'Shoreline armor',
    subtitle: p => join(island(p), fmtYear(p.DateTimeS) ? `surveyed ${fmtYear(p.DateTimeS)}` : undefined),
    action: ACTIONS.shoreline,
  },
  'friends-armor-change-2019': {
    title: () => 'Armor change, 2009 to 2019',
    subtitle: p => join(str(p.FSJ_2012shoreform), str(p.FSJ_2012shoreformID) ? `unit ${str(p.FSJ_2012shoreformID)}` : undefined),
    chips: p => {
      const chips: PopupChip[] = [];
      if (YN(p.ArmorContainsRock)) chips.push({ label: 'Rock' });
      if (YN(p.ArmorContainsConcrete)) chips.push({ label: 'Concrete' });
      if (YN(p.ArmorContainsWood)) chips.push({ label: 'Wood' });
      if (YN(p.ArmorContainsCreosotesWood)) chips.push({ label: 'Creosote wood', tone: 'warn' });
      const c = str(p.ConditionArmor);
      if (c) chips.push({ label: `Condition: ${c}` });
      return chips;
    },
    action: ACTIONS.shoreline,
  },
  'friends-projects': {
    title: p => str(p.NAME) || str(p.kind) || "Friends' project",
    subtitle: p => join(str(p.kind), island(p), str(p.DATE) ? `completed ${str(p.DATE)}` : undefined),
    chips: p => str(p.HABITAT_TYPES).split(',').map(t => t.trim()).filter(Boolean)
      .map(label => ({ label: label.replace(/ Restoration$/i, ''), tone: 'on' as const })),
    stats: p => {
      const ft = num(p.LINEARFEET_SHORELINE);
      const ac = num(p.ACRES_PROTECTED);
      const sq = num(p.SQFT_HABITATRESTORED);
      const n = num(p.AMOUNT);
      return [
        ...(ft ? [{ ...fmtFeet(ft), label: 'Shoreline restored' }] : []),
        ...(ac ? [{ value: fmtAcresValue(ac), unit: 'ac', label: 'Protected' }] : []),
        ...(sq ? [{ value: fmtInt(sq), unit: 'sq ft', label: 'Habitat restored' }] : []),
        ...(n && !ft && !ac && !sq ? [{ value: fmtInt(n), label: n === 1 ? 'Structure upgraded' : 'Structures upgraded' }] : []),
      ];
    },
    story: p => (str(p.DESCRIPTION) ? { kicker: 'What was done', html: escapePlain(str(p.DESCRIPTION)) } : undefined),
    link: p => (str(p.LINK) ? { label: 'Project page ↗', href: str(p.LINK) } : undefined),
  },

  'friends-docks': {
    title: () => 'Dock',
    subtitle: p => join(fmtMonthYear(p.SurveyTime) ? `surveyed ${fmtMonthYear(p.SurveyTime)}` : undefined),
    chips: p => {
      const chips: PopupChip[] = [];
      const m = MATERIAL[str(p.Material).toUpperCase()];
      if (m) chips.push({ label: `${m} deck` });
      const fm = MATERIAL[str(p.FloatMaterial).toUpperCase()];
      if (fm) chips.push({ label: `${fm} float` });
      if (YN(p.Creosote)) chips.push({ label: 'Creosote', tone: 'warn' });
      if (YN(p.Grating)) chips.push({ label: 'Grated', tone: 'on' });
      const c = CONDITION[str(p.Condition).toUpperCase()];
      if (c) chips.push({ label: `Condition: ${c}` });
      return chips;
    },
    action: ACTIONS.structure,
  },
  'friends-mooring-buoys': {
    title: p => BUOY_TYPE[str(p.Type).toUpperCase()] || 'Mooring buoy or float',
    action: ACTIONS.onTheWater,
  },
  'friends-groins': structureSpec('Groin', 'SurveyTime'),
  'friends-boat-ramps': structureSpec('Boat ramp', 'SurveyDate'),
  'friends-marine-railway': structureSpec('Marine railway', 'Surveytime'),
  'friends-pilings': {
    title: () => 'Pilings',
    stats: p => {
      const n = num(p.Count_);
      return n ? [{ value: fmtInt(n), label: 'Pilings' }] : [];
    },
    chips: p => (YN(p.Creosote) ? [{ label: 'Creosote', tone: 'warn' }] : []),
    action: ACTIONS.structure,
  },

  'stormwater-pipes': {
    title: p => (str(p.Pipe_ID) ? `Pipe ${str(p.Pipe_ID)}` : 'Stormwater pipe'),
  },
  'building-footprints': {
    title: () => 'Building',
  },
};

function escapePlain(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Best-effort title for layers without a spec. */
export function fallbackTitle(config: LayerConfig, p: Props): string {
  const candidates = ['name', 'NAME', 'Name', 'title', 'TITLE', 'label', 'LABEL', 'SITE', 'Site', 'id', 'ID'];
  for (const k of candidates) {
    const v = str(p[k]);
    if (v) return v;
  }
  return config.name;
}
