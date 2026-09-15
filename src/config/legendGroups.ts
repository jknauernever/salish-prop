/**
 * Legend groups: several layers shown as one collapsible row in the "On the
 * map" legend (one on/off, one info button, sub-rows when expanded). Group
 * membership is legend-only — the sidebar picker, URL state and popups still
 * treat each layer on its own.
 */
export interface LegendGroup {
  id: string;
  name: string;
  /** Layer ids, in the order the sub-rows appear. */
  layers: string[];
  /** Shown at the top of the group's info modal. */
  description: string;
  /**
   * 'rows' (default): collapsed by default, a chevron expands the per-layer rows.
   * 'chips': always shows the members as a chip strip under the group name, the
   * way Shoreline Geology shows its classes; each chip toggles its layer.
   */
  style?: 'rows' | 'chips';
  /** Short member labels for the chip strip (falls back to the layer name). */
  shortLabels?: Record<string, string>;
}

export const LEGEND_GROUPS: LegendGroup[] = [
  {
    id: 'forage-fish',
    name: 'Forage Fish Spawning',
    layers: ['friends-herring-spawning', 'friends-documented-forage-spawning', 'friends-potential-forage-spawning'],
    style: 'chips',
    shortLabels: {
      'friends-herring-spawning': 'Herring spawning grounds',
      'friends-documented-forage-spawning': 'Smelt & sand lance — documented beaches',
      'friends-potential-forage-spawning': 'Smelt & sand lance — potential habitat',
    },
    description:
      'Where forage fish spawn in San Juan County: Pacific herring on eelgrass and algae in sheltered bays (WDFW), and surf smelt and Pacific sand lance on upper-beach sand and gravel (Friends of the San Juans and WDFW surveys). Documented beaches have been surveyed with eggs found; potential habitat is beach substrate suitable for spawning that fronts the shore.',
  },
  {
    id: 'shoreline-modifications',
    name: 'Shoreline Modifications',
    layers: [
      'friends-armor',
      'friends-docks',
      'friends-mooring-buoys',
      'friends-boat-ramps',
      'friends-marine-railway',
      'friends-groins',
      'friends-pilings',
    ],
    // Friends' own umbrella term: the 2010 "Inventory of Shoreline Modifications for San Juan County"
    // and the Shoreline Modifications section of sanjuans.org's Science and Mapping page.
    description:
      'Hard armor and in- and over-water structures along the shore, from Friends of the San Juans\' Inventory of Shoreline Modifications (2010) and the 2019 countywide armor survey. Each structure type is its own layer; open one for its popup.',
  },
];

export function legendGroupFor(layerId: string): LegendGroup | undefined {
  return LEGEND_GROUPS.find(g => g.layers.includes(layerId));
}

/** Layers pinned to the top of the "On the map" legend, in this order; everything else follows in config order. */
export const LEGEND_FIRST: string[] = ['friends-projects', 'friends-bull-kelp', 'friends-deepwater-eelgrass'];
