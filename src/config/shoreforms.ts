/**
 * Friends of the San Juans geomorphic shoreform classes (the `PIAT_shoreforms`
 * attribute of friends-shoreline-geology). Labels and descriptions are from
 * the Friends "Shoreline Map Set Descriptions" handout; colors drive both the
 * map symbology and the sidebar legend; the popup uses the descriptions.
 *
 * Codes not in the handout (HFB, HFBE, PFB) follow Coastal Geologic Services'
 * usual convention — historic (now-modified) and partial feeder bluffs — and
 * should be confirmed with Friends.
 */
export interface ShoreformType {
  label: string;
  /** Map / legend color — always the color of the class's group (see SHOREFORM_GROUPS). */
  color: string;
  description: string;
  group: ShoreformGroupId;
}

/**
 * Map symbology groups (Tina Whitman, 2026-09-14): all feeder bluffs as one
 * sediment-supply color, estuaries and lagoons together as embayments, and
 * pocket beaches, transport zones, barrier (accretion) beaches and rock kept
 * separate — with hues far enough apart to tell at a glance. The popup still
 * names the exact class.
 */
export type ShoreformGroupId = 'feeder' | 'transport' | 'barrier' | 'pocket' | 'embayment' | 'rocky' | 'artificial';

export const SHOREFORM_GROUPS: Record<ShoreformGroupId, { label: string; color: string }> = {
  feeder: { label: 'Feeder bluff (sediment supply)', color: '#B91C1C' },
  transport: { label: 'Transport zone', color: '#F59E0B' },
  barrier: { label: 'Barrier / accretion beach', color: '#FACC15' },
  pocket: { label: 'Pocket beach', color: '#3B82F6' },
  embayment: { label: 'Embayment (estuary, lagoon)', color: '#0891B2' },
  rocky: { label: 'Rocky shoreline', color: '#4B5563' },
  artificial: { label: 'Artificial', color: '#111827' },
};

export const SHOREFORM_GROUP_ORDER: ShoreformGroupId[] = ['feeder', 'transport', 'barrier', 'pocket', 'embayment', 'rocky', 'artificial'];

export const SHOREFORM_TYPES: Record<string, ShoreformType> = {
  FBE: {
    label: 'Feeder Bluff Exceptional',
    color: SHOREFORM_GROUPS.feeder.color,
    group: 'feeder',
    description:
      'Highly erosive in its natural state, these shore forms tend to have exposed sandy slopes and they are an important source of sediment to form and maintain down-drift beaches.',
  },
  FB: {
    label: 'Feeder Bluff',
    color: SHOREFORM_GROUPS.feeder.color,
    group: 'feeder',
    description:
      'Episodically erosive in its natural state, these shore forms provide sediment that forms and maintains down-drift beaches.',
  },
  HFBE: {
    label: 'Historic Feeder Bluff Exceptional',
    color: SHOREFORM_GROUPS.feeder.color,
    group: 'feeder',
    description:
      'A bluff that was an exceptional sediment source before it was modified. Highly erosive in its natural state, these shore forms are an important source of sediment to form and maintain down-drift beaches.',
  },
  HFB: {
    label: 'Historic Feeder Bluff',
    color: SHOREFORM_GROUPS.feeder.color,
    group: 'feeder',
    description:
      'A bluff that historically supplied beach sediment but has since been modified (typically armored), cutting off that supply to down-drift beaches.',
  },
  PFB: {
    label: 'Feeder Bluff (partial)',
    color: SHOREFORM_GROUPS.feeder.color,
    group: 'feeder',
    description:
      'A bluff that supplies sediment to down-drift beaches along part of its length or at a reduced rate.',
  },
  TZ: {
    label: 'Transport Zone',
    color: SHOREFORM_GROUPS.transport.color,
    group: 'transport',
    description:
      'Neither eroding nor accreting, sediment tends to move through transport zones from feeder, or sediment supply bluffs, to accretionary beaches (spits, barrier beaches).',
  },
  BAB: {
    label: 'Barrier Beach',
    color: SHOREFORM_GROUPS.barrier.color,
    group: 'barrier',
    description:
      'These beaches are typically wide with extended backshores and are where material from the sediment supply bluffs is deposited.',
  },
  'Embayments - Estuary': {
    label: 'Embayment – Estuary',
    color: SHOREFORM_GROUPS.embayment.color,
    group: 'embayment',
    description: 'Relatively closed bay with a freshwater source.',
  },
  'Embayments - Lagoon': {
    label: 'Embayment – Lagoon',
    color: SHOREFORM_GROUPS.embayment.color,
    group: 'embayment',
    description:
      'Lagoons can be open or closed to the marine environment but lack a consistent freshwater source like a stream.',
  },
  'Pocket Beach': {
    label: 'Pocket Beach',
    color: SHOREFORM_GROUPS.pocket.color,
    group: 'pocket',
    description:
      'A sand and gravel beach located between two rocky headlands. The source of material for pocket beaches is the adjacent bank; while material may adjust between the headlands, it seldom leaves the system entirely.',
  },
  'Rocky Shoreline': {
    label: 'Rocky Shoreline',
    color: SHOREFORM_GROUPS.rocky.color,
    group: 'rocky',
    description:
      'While local rocky shorelines include a variety of rock types and configurations, they are all characterized by a lack of appreciable sediment drift or erosion.',
  },
  ART: {
    label: 'Artificial',
    color: SHOREFORM_GROUPS.artificial.color,
    group: 'artificial',
    description: 'Altered so much that the historic shore type is not known.',
  },
};

export function shoreformGroup(code: string) {
  const g = SHOREFORM_TYPES[code]?.group;
  return g ? SHOREFORM_GROUPS[g] : null;
}

export function shoreformLabel(code: string): string {
  return SHOREFORM_TYPES[code]?.label ?? code;
}

/** Legend order: sediment sources first, then transport/deposition, embayments, rock, artificial. */
export const SHOREFORM_LEGEND_ORDER = [
  'FBE', 'FB', 'HFBE', 'HFB', 'PFB', 'TZ', 'BAB',
  'Embayments - Estuary', 'Embayments - Lagoon', 'Pocket Beach', 'Rocky Shoreline', 'ART',
];
