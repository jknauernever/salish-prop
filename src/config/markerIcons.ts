/**
 * Map marker icons in Google's own POI-pin style: a white teardrop pin with a
 * soft drop shadow, the category-colored disc filling its head, and a white
 * glyph — same size and brightness as the park / beach pins Google draws on
 * the base map. The pin's tip is the anchor, so it points at the feature.
 *
 * Built as inline SVG data URIs so there's nothing to keep in sync in /public.
 */

/**
 * CSS pixel size and anchor. Measured from Google's base-map POI icons:
 * ~22 px round head (18 px colored disc + 2 px white ring), a short pointed
 * nub below it, a faint shadow, and an ~11 px white glyph. Anchor = nub tip.
 */
export const MARKER_W = 24;
export const MARKER_H = 26;
export const MARKER_ANCHOR_X = 12;
export const MARKER_ANCHOR_Y = 23;

interface IconSpec {
  /** Disc color (saturated, like Google's category colors). */
  color: string;
  /** Glyph as SVG path data in a 24×24 box, drawn in white. */
  glyph: string;
  /** Draw the glyph as a 2px white stroke (line icon) instead of a filled shape. */
  strokeGlyph?: boolean;
}

// Glyphs are hand-drawn in a 24×24 box, centered.
const SPECS: Record<string, IconSpec> = {
  // Three eelgrass blades rising from a small base
  eelgrass: {
    color: '#12A38E',
    glyph:
      'M12 20c-.3-3.5.2-7.6 1.4-11.1.3-.9 1.6-.7 1.5.3-.4 3.4-1.4 7.2-2.9 10.8zM11.4 20C9.6 16.4 7.9 12.5 7.3 8.1c-.1-1 1.2-1.3 1.6-.4 1.6 3.9 2.7 8 2.5 12.3zM12.6 20c.6-3.3 2.2-6.5 4.8-8.9.7-.7 1.7.2 1.2 1-2.2 3-4.3 5.5-6 7.9z',
  },
  // Mooring buoy: can-shaped float with a mast and light
  buoy: {
    color: '#1A73E8',
    glyph:
      'M11 4h2v4h-2zM10 3h4v1.6h-4zM8.5 9h7l1.2 7.5H7.3zM6.5 17.5h11a1 1 0 0 1 0 2h-11a1 1 0 0 1 0-2z',
  },
  // Dock: deck on three pilings
  dock: {
    color: '#0B8FA8',
    glyph:
      'M4 9h16v2.4H4zM6 11.4h2.2V18H6zM10.9 11.4h2.2V18h-2.2zM15.8 11.4H18V18h-2.2zM4.5 18.5h15v1.5h-15z',
  },
  // Friends' Projects: a site target ring over the water (chosen from the
  // marker exploration canvas, 2026-09-03). Disc color comes per project
  // type via FRIENDS_PROJECT_ICONS; the ring and wave stay white.
  friends: {
    color: '#0D4F4F',
    glyph:
      'M12 4.2a5.8 5.8 0 1 1 0 11.6 5.8 5.8 0 0 1 0-11.6zm0 2.4a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8zm0 1.6a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z M2 19.6c1.7-1.2 3.3-1.2 5 0s3.3 1.2 5 0 3.3-1.2 5 0 3.3 1.2 5 0v2.6H2z',
  },
  // Bird in flight
  bird: {
    color: '#E8710A',
    glyph:
      'M2.5 11.5c3.4-2.6 6.6-2.4 9.5.6 2.9-3 6.1-3.2 9.5-.6-2.6.4-4.6 1.9-6 4.5-.9-1.1-2.1-1.7-3.5-1.7s-2.6.6-3.5 1.7c-1.4-2.6-3.4-4.1-6-4.5z',
  },
};

function buildSvg(spec: IconSpec): string {
  // Base-map POI style: round head with a short nub. Outer shape is white
  // (the ring), inner shape is the category color, glyph is white.
  const W = 24, H = 26;
  const cx = 12, cy = 11;
  // Outer (white) silhouette: circle r=11 with a short nub (≈3 px) at the bottom
  const outer = `M12 0a11 11 0 0 1 4.2 21.2L12 24.2 7.8 21.2A11 11 0 0 1 12 0z`;
  // Inner (colored) shape is a plain circle — only the white outer shape has the nub
  const g = 16 / 24; // glyph scale: 24-box → 16 px, filling most of the 18 px disc
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><filter id="sh" x="-25%" y="-15%" width="150%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="0.9" flood-color="#000" flood-opacity="0.32"/></filter></defs>
  <path d="${outer}" fill="#FFFFFF" filter="url(#sh)"/>
  <circle cx="${cx}" cy="${cy}" r="9" fill="${spec.color}"/>
  <g transform="translate(${cx - 12 * g} ${cy - 12 * g}) scale(${g})">${spec.strokeGlyph
    ? `<path d="${spec.glyph}" fill="none" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="${spec.glyph}" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="0.9" stroke-linejoin="round"/>`}</g>
</svg>`;
}

function dataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29')}`;
}

export const MARKER_ICONS: Record<keyof typeof SPECS, string> = Object.fromEntries(
  Object.entries(SPECS).map(([k, spec]) => [k, dataUri(buildSvg(spec))]),
) as Record<keyof typeof SPECS, string>;

/** A named glyph on a different disc color (e.g. one icon shape, colored by category). */
export function markerIconWithColor(glyph: keyof typeof SPECS, color: string): string {
  return dataUri(buildSvg({ ...SPECS[glyph], color }));
}

/** Friends' project types → marker colors (Friends palette; white globe on each). */
export const FRIENDS_PROJECT_COLORS: Record<string, string> = {
  'Restoration project': '#0297BA',
  'Riparian project': '#3D6410',
  'In/over-water structure project': '#8F6B2E',
  'Restoration site': '#0D4F4F',
};

export const FRIENDS_PROJECT_ICONS: Record<string, string> = Object.fromEntries(
  Object.entries(FRIENDS_PROJECT_COLORS).map(([kind, color]) => [kind, markerIconWithColor('friends', color)]),
);
