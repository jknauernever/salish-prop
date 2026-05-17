# Preset Views Plan

Add support for preset map views accessible via URLs like `/view/salmon-habitat`. Each preset defines which layers are on by default, which features are enabled/disabled, whether the user can modify the view, and per-preset social meta tags.

## Stack context

- Vite + React 19 + TypeScript SPA
- Tailwind v4
- Google Maps JS API
- Deployed to Vercel as static files
- **No router and no SSR currently** — both need to be addressed

## URL pattern

- `/` — default map, unchanged behavior
- `/view/:presetName` — map with preset applied
- Unknown presets fall back to default map (with optional console warning)

## Preset config schema

Define in `src/config/presets.ts`. TypeScript type + a record keyed by preset name.

```ts
type Preset = {
  title: string;
  description?: string;
  layers: string[];                          // layer IDs from config/layers.ts to enable
  features: {
    propertyClick?: boolean;                 // default true
    // add more feature flags here as needed
  };
  locked: boolean;                           // if true, user cannot modify
  lockedControls?: Array<"layers" | "search" | "...">;  // granular lockdown when locked=true
  initialView?: {
    center: { lat: number; lng: number };
    zoom: number;
  };
  meta: {
    title: string;                           // <title> and og:title
    description: string;                     // <meta description> and og:description
    ogImage: string;                         // absolute URL to social preview image
    ogUrl: string;                           // canonical URL for this preset
  };
};
```

## Implementation steps

### 1. Install routing
Add `react-router-dom` (small, handles `/` and `/view/:presetName`). Mount the router in `src/main.tsx`. Two routes: `/` renders `<App />` with no preset, `/view/:presetName` renders `<App preset={...} />` with the resolved preset passed in.

### 2. Create the preset config file
`src/config/presets.ts` with the type above and one starter preset (e.g. `salmon-habitat`) to validate the wiring. Use existing layer IDs from `src/config/layers.ts`.

### 3. Vercel rewrite
Add `vercel.json` with a rewrite so `/view/*` paths serve the matching pre-built HTML file (from step 7) and otherwise fall through to the SPA's `index.html`. Reference Vercel docs for the right rewrite pattern given pre-built per-preset HTML files.

### 4. Refactor map initialization to accept a preset
- `App.tsx` accepts an optional `preset: Preset | null` prop
- `useLayers` (or wherever the initial layer state is set) accepts an initial-layers argument derived from the preset
- `useMap` accepts an optional `initialView` from the preset
- Default behavior (no preset passed) must remain identical to today

### 5. Feature flags
Wrap toggleable behaviors in checks against `preset?.features`:
- `propertyClick` — guard the click handler that opens property details (look in `components/Map/` and `services/popupSpatial.ts`)
- Add other flags as needed as we discover them

When `preset.features.propertyClick === false`, the map should not respond to property clicks.

### 6. Locked UI handling
When `preset.locked === true`:
- Hide or disable controls listed in `preset.lockedControls`
- Specifically: if `"layers"` is in `lockedControls`, hide the layer toggle UI (or render it read-only)
- Default to all controls locked if `locked: true` and `lockedControls` is omitted

### 7. "View full map" link
On any `/view/*` route, render a small link/button (top corner, unobtrusive) labeled "View full map" that navigates to `/`. Hidden on `/`.

### 8. Build-time meta tag generation
Add `scripts/generate-preset-html.ts` that runs after `vite build`:

1. Read `dist/index.html` as a template
2. Import preset config
3. For each preset, generate `dist/view/{presetName}/index.html` by injecting that preset's `meta` values into:
   - `<title>`
   - `<meta name="description">`
   - `<meta property="og:title">`
   - `<meta property="og:description">`
   - `<meta property="og:image">`
   - `<meta property="og:url">`
   - `<meta name="twitter:card" content="summary_large_image">`
4. Wire into `package.json`'s `build` script: `"build": "tsc -b && vite build && tsx scripts/generate-preset-html.ts"`

This means social crawlers (Facebook, LinkedIn, Slack, iMessage) see correct per-preset previews even though the app is otherwise a client-side SPA.

### 9. Real presets
Once the wiring is validated with one test preset, add 2–3 real FSJ-relevant presets. Candidates to discuss with FSJ:
- Salmon habitat focus (chinook, chum, pink salmon layers)
- Forage fish focus (pacific herring, surf smelt, pacific sand lance)
- Shoreline modifications / restoration opportunities

## Open items to decide during implementation

- Exact list of feature flags beyond `propertyClick` (audit `App.tsx` and map components for what should be toggleable)
- Whether `initialView` should be required or optional per preset
- Whether to add a "preset banner" UI element on `/view/*` showing the preset title and description
- Whether locked presets should still allow basic pan/zoom (probably yes — only the layer/feature controls should lock)

## Out of scope for v1

- URL state sync when user modifies an unlocked preset (e.g. updating the URL with layer overrides). Worth considering for v2.
- Preset management UI for non-developers. Presets are code-defined for now.
