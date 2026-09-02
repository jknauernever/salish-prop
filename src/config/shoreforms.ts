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
  color: string;
  description: string;
}

export const SHOREFORM_TYPES: Record<string, ShoreformType> = {
  FBE: {
    label: 'Feeder Bluff Exceptional',
    color: '#B91C1C',
    description:
      'Highly erosive in its natural state, these shore forms tend to have exposed sandy slopes and they are an important source of sediment to form and maintain down-drift beaches.',
  },
  FB: {
    label: 'Feeder Bluff',
    color: '#EA580C',
    description:
      'Episodically erosive in its natural state, these shore forms provide sediment that forms and maintains down-drift beaches.',
  },
  HFBE: {
    label: 'Historic Feeder Bluff Exceptional',
    color: '#DC2626',
    description:
      'A bluff that was an exceptional sediment source before it was modified. Highly erosive in its natural state, these shore forms are an important source of sediment to form and maintain down-drift beaches.',
  },
  HFB: {
    label: 'Historic Feeder Bluff',
    color: '#F97316',
    description:
      'A bluff that historically supplied beach sediment but has since been modified (typically armored), cutting off that supply to down-drift beaches.',
  },
  PFB: {
    label: 'Feeder Bluff (partial)',
    color: '#FB923C',
    description:
      'A bluff that supplies sediment to down-drift beaches along part of its length or at a reduced rate.',
  },
  TZ: {
    label: 'Transport Zone',
    color: '#CA8A04',
    description:
      'Neither eroding nor accreting, sediment tends to move through transport zones from feeder, or sediment supply bluffs, to accretionary beaches (spits, barrier beaches).',
  },
  BAB: {
    label: 'Barrier Beach',
    color: '#EAB308',
    description:
      'These beaches are typically wide with extended backshores and are where material from the sediment supply bluffs is deposited.',
  },
  'Embayments - Estuary': {
    label: 'Embayment – Estuary',
    color: '#0D9488',
    description: 'Relatively closed bay with a freshwater source.',
  },
  'Embayments - Lagoon': {
    label: 'Embayment – Lagoon',
    color: '#14B8A6',
    description:
      'Lagoons can be open or closed to the marine environment but lack a consistent freshwater source like a stream.',
  },
  'Pocket Beach': {
    label: 'Pocket Beach',
    color: '#2563EB',
    description:
      'A sand and gravel beach located between two rocky headlands. The source of material for pocket beaches is the adjacent bank; while material may adjust between the headlands, it seldom leaves the system entirely.',
  },
  'Rocky Shoreline': {
    label: 'Rocky Shoreline',
    color: '#6B7280',
    description:
      'While local rocky shorelines include a variety of rock types and configurations, they are all characterized by a lack of appreciable sediment drift or erosion.',
  },
  ART: {
    label: 'Artificial',
    color: '#1F2937',
    description: 'Altered so much that the historic shore type is not known.',
  },
};

export function shoreformLabel(code: string): string {
  return SHOREFORM_TYPES[code]?.label ?? code;
}

/** Legend order: sediment sources first, then transport/deposition, embayments, rock, artificial. */
export const SHOREFORM_LEGEND_ORDER = [
  'FBE', 'FB', 'HFBE', 'HFB', 'PFB', 'TZ', 'BAB',
  'Embayments - Estuary', 'Embayments - Lagoon', 'Pocket Beach', 'Rocky Shoreline', 'ART',
];
