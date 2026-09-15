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
}

export const LEGEND_GROUPS: LegendGroup[] = [
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
