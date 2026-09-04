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
  /** Side of the square box the glyph is drawn in (default 24). */
  box?: number;
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
  // Boat ramp: "Map icons by Scott de Jonge" boat-ramp glyph, used as-is
  // (CC BY 4.0, via Wikimedia Commons; 50×50 box).
  ramp: {
    color: '#4682B4',
    box: 50,
    glyph:
      'M8.5 7.092l9.565 2.639 5.309-3.731 1.847.455-5.259 3.742 28.985 8.053-2.121 7.882-29.093-8.031c-11.271-3.399-9.216-11.009-9.216-11.009M33.957 27.258c-.035-.658-.16-1.285-.375-1.877l13.281 3.697-.426 1.639-12.48-3.459zm-12.066-3.332c.358-.521.782-.991 1.264-1.398l-22.155-6.12v1.763l20.891 5.755zm5.486 5.836c1.191 0 2.158-.969 2.158-2.16 0-1.195-.967-2.162-2.158-2.162-1.195 0-2.161.967-2.161 2.162 0 1.191.966 2.16 2.161 2.16zm21.623 13.238c-1.051 0-2.051-.238-2.943-.648-.928-.42-1.963-.672-3.047-.672-1.08 0-2.121.252-3.035.672-.905.41-1.903.648-2.955.648-1.051 0-2.053-.238-2.955-.648-.92-.42-1.953-.672-3.035-.672-1.086 0-2.119.252-3.045.672-.893.41-1.905.648-2.951.648-1.045 0-2.051-.238-2.949-.648-.926-.42-1.967-.672-3.046-.672-1.08 0-2.12.252-3.035.672-.898.41-1.909.648-2.956.648-1.045 0-2.051-.238-2.955-.648-.916-.42-1.956-.672-3.036-.672-1.079 0-2.119.252-3.04.672-.897.41-1.909.648-2.949.648l-.068-17.605 24.227 6.686c-1.67-.807-2.83-2.5-2.83-4.479 0-2.754 2.227-4.983 4.979-4.983 2.744 0 4.977 2.229 4.977 4.983 0 2.752-2.232 4.98-4.977 4.98l-.49-.047 22.078 6.088.036 4.377z',
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
  const box = spec.box ?? 24;
  const g = 16 / box; // glyph scale: box → 16 px, filling most of the 18 px disc
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><filter id="sh" x="-25%" y="-15%" width="150%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="0.9" flood-color="#000" flood-opacity="0.32"/></filter></defs>
  <path d="${outer}" fill="#FFFFFF" filter="url(#sh)"/>
  <circle cx="${cx}" cy="${cy}" r="9" fill="${spec.color}"/>
  <g transform="translate(${cx - (box / 2) * g} ${cy - (box / 2) * g}) scale(${g})">${spec.strokeGlyph
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
