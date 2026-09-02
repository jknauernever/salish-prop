# Salish Sea Explorer

**"Protect this Place"** — An interactive property engagement tool for the San Juan Islands, built for [Friends of the San Juans](https://sanjuans.org). Combines tax parcel data, building footprints, fish habitat mapping, stormwater infrastructure, and satellite-derived vegetation analysis into a single map-based experience.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Datasets](#datasets)
- [Map Layers](#map-layers)
- [Spatial Query System](#spatial-query-system)
- [Property Popup (FeaturePopup)](#property-popup-featurepopup)
- [Nearshore Habitat in Property Popups](#nearshore-habitat-in-property-popups)
- [Preset Views](#preset-views)
- [Shareable URLs & Link Previews](#shareable-urls--link-previews)
- [Admin Tool](#admin-tool)
- [NDVI / Vegetation Analysis](#ndvi--vegetation-analysis)
- [Cloud Functions](#cloud-functions)
- [Theming & Styling](#theming--styling)
- [Project Structure](#project-structure)
- [Dependencies](#dependencies)
- [Lessons Learned](#lessons-learned)

---

## Features

### Interactive Map
- Google Maps (hybrid satellite + roads) centered on the San Juan Islands (48.53, -123.02)
- 20 configurable layers across five categories: Fish Habitat, Ecological, Property, Planning & Infrastructure, Community Science
- Layer toggle, per-category show/hide, opacity slider for raster layers
- Viewport-filtered rendering for Tax Parcels and Building Footprints (only draws features in the current view; full dataset stays in memory for spatial queries)
- Zoom-level enforcement per layer (e.g., parcels appear at zoom 15+)

### Address Search
- Google **PlaceAutocompleteElement** (new Places API web component) with a soft location bias to San Juan County bounds (48.40–48.85 lat, -123.25 to -122.75 lng)
- Results from outside SJC still resolve (so users can paste any US address), with local results ranked higher
- Selecting an address recenters the map, draws a quarter-mile radius overlay, and opens the property popup at the containing parcel

### Spatial Query
- Turf.js point buffer with bbox pre-filter for performance
- Four radius presets: 1/4 mi (402 m), 1/2 mi (805 m), 1 mi (1609 m), 2 mi (3219 m)
- Results grouped by layer in a slide-in PropertyReport panel
- Each result shows all GeoJSON properties with formatted values (currency, dates, humanized field names)

### Tabbed Property Popup
- **Summary** — Mini-map snapshot with NDVI overlay clipped to parcel, at-a-glance stats (acres, buildings, sq ft, assessed value, waterfront footage), location & classification, last sale info, clickable address
- **Property** — Full parcel record (PIN, legal description, tax area, land/building/appraised values, use code, sale date/price)
- **Buildings** — Count and total sq ft of buildings on the parcel, per-building details
- **Shoreline** — Fish species habitat relevance (HRM / LRM scores) for seven species, shoreline geomorphic description, methodology info window with academic citations

### Vegetation Analysis (NDVI)
- Two raster layers: high-resolution NAIP (0.6 m) and seasonal Sentinel-2 (10 m)
- Per-parcel NDVI statistics (mean, std dev, land-cover breakdown)
- Island-relative percentile ranking ("Well Below Average" through "Among the Greenest")
- Sentinel-2 date picker (Spring / Summer / Fall, 2017–2025) powered by a Google Earth Engine cloud function

### UI / UX
- PNW-inspired theme: teals, slate blues, fog grays, forest greens (Source Sans 3 font)
- Slide-out sidebar with grouped layer controls, feature-count badges, loading spinners
- Floating map legend (`src/components/Map/MapLegend.tsx`, top-left) listing only the layers currently on: swatch, per-layer info button, "zoom in" hint for zoom-gated layers, "not in view" hint (rows are highlighted only when a feature actually intersects the current map frame — `src/hooks/useLayersInView.ts`, recomputed on map idle with cached per-feature bounds), off switch, an **Explore more data** button that opens the sidebar picker, and a **How this is sourced** link that opens a modal describing every visible dataset with its source credit and link. Hidden while the sidebar is open and in locked preset views.
- Point layers use Google-POI-style SVG pins (`src/config/markerIcons.ts`); bull kelp draws through a canvas overlay (`src/components/Map/KelpOverlay.ts`) with a cream wash, animated nautical "kelp squiggle" pattern from zoom 12.5, and a soft band below that.
- Bull Kelp and Deepwater Edge of Eelgrass are on by default at county zoom; the spawning layers are on by default but only drawn from zoom 14 (`minZoom`).
- Slide-in report panel with collapsible sections and radius selector
- Custom event bridge: clicking an address inside a parcel popup triggers a new search

---

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌───────────────────┐
│  AddressSearch│────▶│  MapContainer │────▶│  useSpatialQuery  │
│  (Places API) │     │  (Google Maps)│     │  (Turf.js buffer) │
└──────────────┘     └──────┬───────┘     └────────┬──────────┘
                            │                       │
                    ┌───────▼───────┐       ┌───────▼──────────┐
                    │   useLayers   │       │  PropertyReport   │
                    │  (Data + Tile │       │  (slide-in panel) │
                    │   instances)  │       └──────────────────┘
                    └───────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        google.maps    google.maps    google.maps
          .Data          .Data       .ImageMapType
       (per vector    (per vector     (per raster
         layer)         layer)          layer)
```

**Key design decisions:**

- **Separate `google.maps.Data` per vector layer** — independent styling, visibility, and click handlers
- **Raster tiles via `google.maps.ImageMapType`** — inserted at `overlayMapTypes[0]` (renders below vectors); toggled via opacity (0 = hidden)
- **Viewport filtering** for large layers (Tax Parcels, Building Footprints) — pre-computed feature bbox index; features added/removed on `idle` event
- **Swappable `SpatialQueryService` interface** — currently Turf.js in-browser; designed for future PostGIS backend
- **Custom event bridge** — `ParcelSearchEvent` and `OpenParcelPopupEvent` for cross-component communication without prop drilling

---

## Getting Started

### Prerequisites

- **Node.js** 18+ and npm
- A **Google Maps Platform** project with these APIs enabled:
  - Maps JavaScript API
  - **Places API (New)** — required for `PlaceAutocompleteElement` (the classic Places API is *not* used)
  - Geocoding API
- A **Map ID** configured for the Maps JavaScript API (required for AdvancedMarkerElement)
- The Maps API key's **Website restrictions** must include `http://localhost:5173/*` for local dev (and your production domain for deployment). The port-wildcard pattern (`localhost:*/*`) is unreliable — list each port literally.

### Installation

```bash
git clone https://github.com/jknauernever/salish-prop.git
cd salish-prop
npm install
```

### Configuration

Copy `.env.example` to `.env` and fill in your keys:

```bash
cp .env.example .env
```

```
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key
VITE_GOOGLE_MAPS_MAP_ID=your_google_maps_map_id
```

### Running the Dev Server

```bash
npm run dev
```

Opens at **http://localhost:5173/**. Vite provides HMR (hot module replacement) — edits to `.tsx` files reflect instantly.

### Building for Production

```bash
npm run build    # tsc -b && vite build && tsx scripts/generate-preset-html.ts
npm run preview  # Serve the production build locally
```

The `build` script runs three stages:
1. `tsc -b` — TypeScript type check across project references.
2. `vite build` — Bundles the SPA into `dist/`.
3. `tsx scripts/generate-preset-html.ts` — For every preset in `src/config/presets.ts`, writes `dist/view/{presetName}/index.html` with that preset's `<title>` and Open Graph / Twitter meta tags injected. See [Preset Views](#preset-views) for why.

---

## Environment Variables

| Variable | Description |
|---|---|
| `VITE_GOOGLE_MAPS_API_KEY` | Google Maps JavaScript API key |
| `VITE_GOOGLE_MAPS_MAP_ID` | Google Maps Map ID (required for Advanced Markers) |

Both are accessed at runtime via `import.meta.env.VITE_*`.

---

## Datasets

All data lives in `public/data/` and is fetched at runtime via HTTP.

### GeoJSON Files

| File | Size | Records | Geometry | Description |
|---|---|---|---|---|
| `Tax_Parcels.geojson` | 133 MB | 19,020 | Polygon (3D) | San Juan County tax parcels — PIN, legal description, valuation, sale history, use codes (33 fields) |
| `Building_Footprints.geojson` | 17 MB | 31,026 | Polygon | Building footprints — sq ft, island, PIN, source (5 fields) |
| `Stormwater_Pipes.geojson` | 1.9 MB | 1,785 | LineString | Stormwater pipe network — pipe ID, diameter, material, elevation, installation year (38 fields) |
| `chinook-salmon.geojson` | 5.2 MB | 2,842 | LineString | Chinook salmon shoreline habitat (HRM/LRM scores, geomorphic data) |
| `chum-salmon.geojson` | 5.2 MB | 2,842 | LineString | Chum salmon shoreline habitat |
| `pink-salmon.geojson` | 5.2 MB | 2,842 | LineString | Pink salmon shoreline habitat |
| `pacific-herring.geojson` | 5.2 MB | 2,842 | LineString | Pacific herring shoreline habitat |
| `pacific-sand-lance.geojson` | 5.2 MB | 2,842 | LineString | Pacific sand lance shoreline habitat |
| `surf-smelt.geojson` | 5.2 MB | 2,842 | LineString | Surf smelt shoreline habitat |
| `lingcod-greenling.geojson` | 5.2 MB | 2,842 | LineString | Lingcod & greenling shoreline habitat |

All seven fish habitat files share an identical 56-field schema including HRM/LRM pairs for every species, geomorphic unit classification, material class, and slope data.

### JSON Lookup Files

| File | Size | Records | Description |
|---|---|---|---|
| `address_lookup.json` | 3.1 MB | 12,437 PINs | PIN → address/building records (full address, building type, description, island) |
| `ndvi_parcel_stats.json` | 2.1 MB | 19,020 | Parcel index → NDVI statistics (mean, stdDev, water/bare/sparse/moderate/dense/veryDense %) |

### Data Quirks

- **Tax_Parcels.geojson has 3D coordinates** — every vertex includes `z = 0.0`. The `fetchGeoJSON()` utility strips the Z coordinate automatically before passing data to Turf.js (which doesn't handle 3D geometries).
- **Building_Footprints.geojson has minimal properties** — only FID, Sq_Ft, Island, PIN, and Source. Address info comes from `address_lookup.json`.
- **Fish habitat files are identical in schema** — each contains HRM/LRM scores for *all* seven species, not just the one named in the filename. The UI filters to the relevant species per layer.

---

## Map Layers

Configured in `src/config/layers.ts`. Layers are grouped into categories:

### Fish Habitat (7 layers)
Shoreline segments scored by Habitat Relevance Modeling (HRM) and Landscape Relevance Modeling (LRM) for each species. Line geometry, no fill.

| Layer | Stroke Color | Species Fields |
|---|---|---|
| Chinook Salmon | `#E63946` (red) | HRM_Ck / LRM_Ck |
| Chum Salmon | `#7B2D8E` (purple) | HRM_Chum / LRM_Chum |
| Pink Salmon | `#FF6B9D` (pink) | HRM_Pk / LRM_Pk |
| Pacific Herring | `#F4D35E` (yellow) | HRM_Herr / LRM_Herr |
| Pacific Sand Lance | `#FF8C42` (orange) | HRM_Lance / LRM_Lance |
| Surf Smelt | `#4ECDC4` (cyan) | HRM_Smelt / LRM_Smelt |
| Lingcod & Greenling | `#6B8F71` (olive) | HRM_Hex / LRM_Hex |

### Ecological (6 layers)
| Layer | Type | Source | Notes |
|---|---|---|---|
| Vegetation Health (NDVI) | Raster (static) | GCS bucket, NAIP Oct 2023 | 0.6 m resolution, zoom 10–17 |
| Sentinel-2 NDVI (10 m) | Raster (dynamic) | Earth Engine Cloud Function | Seasonal date picker, zoom 10+ |
| Forest Loss (2001–2025) | Raster (dynamic, no date picker) | Earth Engine Cloud Function (`hansen-forest-change`) | UMD Hansen Global Forest Change; loss pixels colored by year (dark red → yellow); 30 m, zoom 9+ |
| Forest Disturbance (DIST-ALERT) | Raster (dynamic, mode toggle) | Earth Engine Cloud Function (`opera-dist-alert`) | OPERA L3 DIST-ALERT (GLAD mirror), 30 m, zoom 9+. Three viz modes: recency / status / severity. Near-real-time companion to the Hansen layer. |
| Eelgrass Beds | Vector | *Placeholder* | Data pending |
| Shoreline Types | Vector | *Placeholder* | Data pending |
| Habitat Zones | Vector | *Placeholder* | Data pending |

### Property (2 layers)
| Layer | Type | Min Zoom | Notes |
|---|---|---|---|
| Tax Parcels | Vector (viewport-filtered) | 15 | Gray fill, orange stroke; click opens tabbed popup |
| Building Footprints | Vector (viewport-filtered) | 15 | Blue fill, dark stroke |

### Planning & Infrastructure (1 layer)
| Layer | Type | Notes |
|---|---|---|
| Stormwater Infrastructure | Vector | Orange stroke; includes conservation messaging about stormwater pollution |

---

## Spatial Query System

### How It Works

1. **Point buffer** — `turf.buffer(point, radius)` creates a circular polygon around the search center
2. **Bbox pre-filter** — each feature's bounding box is pre-computed at load time; only features whose bbox intersects the buffer bbox are tested
3. **Intersection test** — `turf.booleanIntersects(feature, buffer)` for precise geometry comparison
4. **Home parcel** — `turf.booleanPointInPolygon(center, parcel)` finds the parcel directly under the search point

### Popup-Specific Queries (`src/services/popupSpatial.ts`)

When a parcel popup opens, two additional spatial queries run:

- **Building count** — finds all building footprints whose geometry intersects the parcel polygon; sums `Sq_Ft`
- **Shoreline habitat** — buffers the parcel 50 ft, finds intersecting fish habitat segments, aggregates HRM/LRM per species across all seven layers

---

## Property Popup (FeaturePopup)

The popup is an `google.maps.InfoWindow` rendered as a tabbed HTML interface. It opens when a user clicks a tax parcel or when an address search resolves to a parcel.

### Summary Tab
- **Mini-map snapshot** — a small embedded Google Map showing the parcel boundary, NDVI overlay clipped to the parcel shape (via `google.maps.Polygon` donut mask), and building footprints
- **At-a-Glance stats** — acres, building count, total sq ft, assessed value (land + building), waterfront footage
- **Location** — island, classification (use code description), residential/commercial type
- **Sale info** — last sale price and date
- **Clickable address** — dispatches `ParcelSearchEvent` to trigger a new search

### Property Tab
Full parcel record: PIN, legal description, tax area, land value, appraised value, building value, use code, sale date, sale price.

### Buildings Tab
Building count and total footprint sq ft. Lists individual buildings with their properties.

### Shoreline Tab
- Species habitat relevance table — each row shows a species name, HRM score (bar chart), and LRM score
- Shoreline description — geomorphic unit, system type, sub-type, material class
- "Learn more" info window explaining the Habitat Relevance Score methodology

### Greenery Card (inside Summary)
- **NDVI mean** for the parcel
- **Percentile circle** — compares parcel greenness to all other parcels on the same island (Tax_Area field)
- **Rating label** — Well Below Average (0–9%), Below Average (10–24%), Average (25–49%), Above Average (50–74%), Well Above Average (75–89%), Among the Greenest (90–100%)
- **Land cover breakdown** — stacked bar chart: Water (blue), Bare/Paved (red), Grass/Low Plants (orange), Shrubs/Garden (yellow-green), Trees (green), Dense Forest (dark green)

---

## Nearshore Habitat in Property Popups

The property popup's **Nearshore Habitat** card (Summary tab) and the **Shoreline** tab report bull kelp, eelgrass, forage fish spawning beaches, and herring spawning grounds near the parcel. These come from a **precomputed per-parcel file**, not live spatial queries, so they appear for every property regardless of which layers are switched on (the old live query only worked if the 400 MB kelp layer happened to be loaded, and used a 100 ft buffer that missed offshore beds).

| Dataset | Rule | Reported |
|---|---|---|
| Bull kelp | within **500 ft** of the parcel | grid-cell count, acres (from geometry), nearest distance |
| Eelgrass deep-water edge | within **500 ft** | segment count, length, mean/max depth, nearest distance, survey sites |
| Documented forage fish spawning beaches | within **100 ft** | beach names, species (surf smelt / sand lance), distance |
| Potential forage fish spawning beaches | within **100 ft** | count |
| Herring spawning grounds | within **100 ft** (client: same as forage fish) | ground names |
| Friends geomorphic shoreform | nearest segment within **50 ft** | shore type (`PIAT_shoreforms`), forage fish habitat flag, PIAT protection/restoration priority, SMP designation, public ownership |

- **Bull kelp geometry:** the Friends/DNR 2007 kelp file is a raster converted to vectors — 228,964 polygons with a median size of **one square foot** (400 MB). Drawn as-is it is invisible at every zoom. [`scripts/build-kelp-patches.py`](scripts/build-kelp-patches.py) buffers the cells 20 ft, dissolves, shrinks 12 ft, simplifies, and writes `public/data/friends-bull-kelp-patches.geojson` (patches with `acres`), which is what the Bull Kelp layer and the stats script now use. Re-run it only if Friends supply new kelp data.
- **Script:** [`scripts/compute-nearshore-stats.py`](scripts/compute-nearshore-stats.py) (shapely + pyproj; ~2 min). Reprojects everything to EPSG:2926 (feet), runs STRtree lookups, writes `public/data/nearshore_parcel_stats.json` keyed by parcel **FID** (same key as the NDVI stats). Only parcels with at least one hit are stored (~5,900 of 19,020; ~700 KB). Distances live in the file's `meta` and the popup copy reads them from there, so changing the constants at the top of the script and re-running is all that's needed to retune.
- **Shoreforms:** `src/config/shoreforms.ts` holds the twelve shore-type codes with labels, colors, and the handout descriptions. It drives the Shoreline Geology layer's per-type symbology and legend and the popup's **Shoreline Type** card (which replaces the Beamer geo-unit description whenever a Friends shoreform lies within 50 ft; the Beamer text remains as fallback). Codes HFB / HFBE / PFB are not in the handout and are labeled per Coastal Geologic Services convention — confirm with Friends.
- **Client code:** `src/services/nearshoreStats.ts` (fetch + cache), `nearshoreFromStats()` in `src/services/popupSpatial.ts`, and the card builders in `FeaturePopup.tsx`. The explanatory kelp / eelgrass sentences are the client's wording from the Sept 2026 revision doc.
- Re-run the script whenever `Tax_Parcels.geojson` or any of the five Friends files change.

---

## Preset Views

Preset views are shareable, configurable map URLs that bundle a set of default layers, an initial map view, feature flags, and per-URL social preview meta tags. They're driven by code-defined configs in `src/config/presets.ts`, served by client-side React Router routes, and (in production) backed by build-time–generated HTML files so social crawlers see correct previews.

### URL Pattern

| URL | Behavior |
|---|---|
| `/` | Default map. No preset applied. Identical to pre-preset behavior. |
| `/view/:presetName` | Preset applied. Layers, initial view, and feature flags come from `presets[presetName]`. |
| `/view/unknown-name` | Unknown preset → falls back to the default map. A `console.warn` is logged for visibility. |

### Defining a Preset

All presets are TypeScript objects exported from [`src/config/presets.ts`](src/config/presets.ts).

```ts
type Preset = {
  title: string;
  description?: string;
  layers: string[];                                // layer IDs from src/config/layers.ts to enable
  features: {
    propertyClick?: boolean;                       // default true; when false, parcel clicks + popup-from-search are disabled
  };
  locked: boolean;                                 // when true, hide/disable UI controls
  lockedControls?: Array<'layers' | 'search'>;     // granular lockdown; omitted = lock everything
  initialView?: {
    center: { lat: number; lng: number };
    zoom: number;
  };
  meta: {
    title: string;                                 // <title> and og:title
    description: string;                           // <meta name="description"> and og:description
    ogImage: string;                               // absolute URL to social preview image
    ogUrl: string;                                 // canonical URL for this preset
  };
};
```

### How Preset Application Flows Through the App

1. [`src/main.tsx`](src/main.tsx) mounts `<BrowserRouter>` with two routes: `/` renders `<App />` (no preset prop); `/view/:presetName` renders a small `PresetView` wrapper that calls `getPreset(name)` and passes the resolved preset (or `null`) into `<App preset={...} />`.
2. `App` threads `preset?.initialView` into `MapContainer` (which uses it for the initial Google Maps `center` / `zoom`) and `preset?.layers` into `useLayers` (as the `initialLayerIds` override for default visibility — overrides each layer's `config.visible`).
3. `App` derives a `lockedSet` from `preset.locked` + `preset.lockedControls`. When `locked: true` is set without `lockedControls`, all lockable controls are locked. The set drives:
    - `searchLocked` → omit the `<AddressSearch>` slot from the header
    - `layersLocked` → hide the sidebar toggle button (`hideSidebarToggle` prop on `<Header>`) and skip rendering `<Sidebar>` entirely
4. `App` passes `preset?.features.propertyClick ?? true` to `<FeaturePopup>`. With `propertyClick: false`, both paths that open the property-details popup are dead:
    - Map clicks on the `tax-parcels` layer (the click listener is not registered for that one layer)
    - `OPEN_PARCEL_POPUP_EVENT` (the event listener is not registered) — so address-search-recenter still works, but it does not open the parcel popup
5. On any `/view/*` route (preset resolved or not), a small "← View full map" link is rendered in the header's right-side cluster. It uses `react-router-dom`'s `<Link to="/">` for client-side navigation. The element-type change between `<App />` and `<PresetView />` causes a fresh mount, which cleanly resets all preset state.

### SPA Routing on Vercel + Per-Preset HTML for Social Previews

The challenge: the app is a client-side SPA, but social crawlers (Facebook, LinkedIn, Slack, iMessage, etc.) don't run JavaScript. They read static `<meta>` tags from the response HTML. For a crawler to see correct previews for `/view/salmon-habitat`, the HTML returned at that URL must contain the right title / description / OG tags.

The solution is two pieces working together:

1. **Build-time HTML generation** — [`scripts/generate-preset-html.ts`](scripts/generate-preset-html.ts) runs after `vite build`. It reads `dist/index.html` as a template, then for each preset writes `dist/view/{presetName}/index.html` with:
    - `<title>` replaced with `preset.meta.title`
    - These tags injected before `</head>`:
        - `<meta name="description">`
        - `<meta property="og:title" | og:description | og:image | og:url | og:type>`
        - `<meta name="twitter:card" content="summary_large_image">`
    - All other tags (assets, fonts, viewport) preserved from the SPA template, so JS/CSS load with the same hashed asset URLs.

2. **Vercel filesystem-precedence routing** — [`vercel.json`](vercel.json) has a single catch-all rewrite to `/index.html`:

    ```json
    { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
    ```

    Vercel's routing order is **filesystem → redirects → rewrites**. Real files always win first. So:

    | URL | What happens |
    |---|---|
    | `/view/salmon-habitat` | `dist/view/salmon-habitat/index.html` exists → served. Crawler sees preset meta tags. SPA loads → React Router renders the preset. |
    | `/view/unknown` | No file → catch-all rewrite → `dist/index.html` → SPA loads → `getPreset('unknown')` returns `null` → fallback default map. |
    | `/assets/main.js` | Real file → served as-is (rewrite skipped). |
    | `/` | Real `dist/index.html` → served. |

### Local Behavior vs. Production Behavior

- In `npm run dev`, Vite serves the raw `index.html` for every route. Per-preset titles/meta tags are **not** visible — that's expected, they only live in the build-time generated files. You can verify runtime preset application (layers, initial view, View full map link) just fine in dev; meta tags require `npm run build && npm run preview`.
- `npm run preview` serves `dist/` statically on port 4173 — the closest local approximation to Vercel.

### Adding a New Preset

1. Open [`src/config/presets.ts`](src/config/presets.ts).
2. Add an entry to the `presets` record. Use layer IDs from [`src/config/layers.ts`](src/config/layers.ts).
3. `npm run build` to verify the preset HTML generates correctly under `dist/view/{name}/index.html`.
4. Deploy. The route `https://your-domain/view/{name}` immediately works.

---

## Shareable URLs & Link Previews

Everything a visitor can change on the map is mirrored into the query string, so the address bar is always a link to exactly that view. The header **Share** button copies it (or opens the OS share sheet on phones). Implemented in [`src/services/urlState.ts`](src/services/urlState.ts); writes are debounced and use `history.replaceState`, so the back button is untouched.

| Param | Meaning | Example |
|---|---|---|
| `c` | center `lat,lng` | `c=48.60500,-123.00000` |
| `z` | zoom | `z=10.8` |
| `b` | basemap (omitted when hybrid) | `b=roadmap` |
| `l` | visible layer ids, comma-separated (`l=` = none; absent = defaults, or the preset's layers on `/view/*`). Omitted while the selection equals the defaults. | `l=tax-parcels,friends-bull-kelp` |
| `o` | raster opacity overrides | `o=ndvi-naip:0.5` |
| `m` | visualization mode for multi-mode rasters | `m=opera-dist-alert:status` |
| `s` | Sentinel-2 season | `s=ndvi-sentinel:summer-2024` |
| `d` | date filter for observation layers (`start..end`, either side optional) | `d=marbled-murrelet-obs:2025-01-01..` |
| `p` | open parcel popup at `lat,lng` (restored once parcel data loads) | `p=48.53470,-123.01730` |
| `q` | address-search center (draws the ¼-mile radius) | `q=48.53470,-123.01730` |
| `sb` | sidebar open | `sb=1` |

Works on `/` and on `/view/:preset` (URL params override the preset's initial view and layers). When a visitor arrives via a link that carries map state, the landing intro box starts collapsed to its pill so the shared view is unobstructed.

### Link previews (Open Graph)

Pasting a share link into iMessage, Slack, Facebook, etc. unfurls with a preview of *that* view:

- **`api/share.ts`** (Vercel Node function) — `vercel.json` uses `routes` (not `rewrites`, which run after the static filesystem check and so never fire for `/`) to send `/` and `/view/:preset` **only when the request carries a `c` param** to this function, ahead of the filesystem handler. It fetches the built SPA shell, injects `og:*` / `twitter:*` tags (title, description listing the visible layers, `og:url`, and an `og:image` pointing at `/api/og` with the view params) and returns the HTML. Plain visits are still served statically.
- **`/api/og`** → rewritten to the **`og-image` Cloud Function** ([`cloud-functions/og-image/main.py`](cloud-functions/og-image/main.py), Python + Pillow). Renders a 1200×630 PNG: Google **Static Maps** at the shared center/zoom/basemap using the same Map ID (so the cloud style — hidden commercial POI labels — matches the live map), a marker on the shared property, the Friends of the San Juans logo top-right, and a small "Salish Sea Explorer" label bottom-left. Data layers themselves are not drawn (Static Maps can't render our GeoJSON); the `og:description` names them instead. Cached for a week per unique query. (An `@vercel/og` edge version was tried first; Vercel's edge bundler rejects it in this ESM project.)
- **`api/_shareState.ts`** — server-side parser for the same query keys (imports `src/config/layers.ts` for layer names).
- **Abuse guard (signed image URLs):** `api/share.ts` signs the image params (HMAC-SHA256 over the sorted `k=v` pairs, hex, first 32 chars → `sig`) with `OG_SIGNING_SECRET`; the `og-image` function rejects any request carrying view params without a valid `sig` (HTTP 403). The bare default image (no params, used by `index.html`) stays unsigned. So crawlers can fetch minted URLs, copied URLs only replay a cached image, and nobody can burn Static Maps quota with made-up coordinates. The secret lives on Vercel (`OG_SIGNING_SECRET`, all envs) and on the function (`--update-env-vars OG_SIGNING_SECRET=…`).
- **Cost guards:** Static Maps is free for the first 10,000 requests/month, then $2 per 1,000. A per-day quota cap on the Static Maps API in the GCP project bounds worst-case spend, and a $10/month billing budget on the project emails at 50% and 100%. When the cap is hit, Google refuses the map and the function falls back to the branded gradient card — the shared link itself keeps working.
- **Key:** `GOOGLE_STATIC_MAPS_KEY` is an env var on the `og-image` function only (server-side; restricted to the Static Maps API, no referrer restriction since it's never exposed to browsers). Created in the `salish-sea-property-mapper` GCP project as "Static Maps (server, OG previews)". Without it the image falls back to a branded gradient card. (The same value is also stored on Vercel as `GOOGLE_STATIC_MAPS_KEY`, unused by the current code but kept for a future Vercel-side renderer.)

Deploy the image function:

```bash
gcloud functions deploy og-image --gen2 --region us-west1 --project salish-sea-property-mapper \
  --runtime python311 --entry-point og_image --trigger-http --allow-unauthenticated \
  --source cloud-functions/og-image --memory 512M --set-env-vars GOOGLE_STATIC_MAPS_KEY=<key>
```

- `index.html` carries default OG tags for the bare landing page (`/api/og` with no params = default view).

Test a preview with e.g. `https://salishsea.knauernever.com/api/og?c=48.5347,-123.0173&z=15&l=friends-bull-kelp&p=48.5347,-123.0173`, or paste a share link into [opengraph.xyz](https://www.opengraph.xyz/).

---

## Admin Tool

A password-gated `/admin` area inside the same app, for content administrators to maintain runtime configuration without code changes. Two modules so far: the **Category Tree Editor** (how the public sidebar groups data layers) and the **Landing Page Intro** editor (the welcome box shown on the map).

### URL pattern

| URL | Purpose |
|---|---|
| `/admin` | Sign-in screen, then admin home (module picker). |
| `/admin/categories` | Category tree editor — the focus of v1. |
| `/admin/content` | Landing page intro editor (rich text). |
| `/api/admin/categories` | Same-origin endpoint the category editor calls (proxied to a Cloud Function — see Architecture below). Not for direct browser use. |
| `/api/admin/content` | Same-origin endpoint the intro editor calls (same Cloud Function, `/content` sub-path). |

### Authentication

- Single shared password stored only as an env var on the Cloud Function (`ADMIN_PASSWORD`). Never set on Vercel or in code.
- When an admin enters the password on the sign-in screen, the UI calls `POST /api/admin/categories?verify=1` with the password in an `X-Admin-Token` header. The function responds `204 No Content` on a match, `401 Unauthorized` on a mismatch — no side effects either way. Only the 204 response stores the token in `sessionStorage` and reveals the admin shell.
- Every write request (`POST /api/admin/categories`) re-checks the same header. The Cloud Function compares with `hmac.compare_digest` (constant-time) so wrong tokens can't be timing-distinguished.
- "Sign out" clears `sessionStorage`. The token lives only for the current tab.
- This is a single-secret model — appropriate for v1's small admin team. Multi-user auth + roles are out of scope.

### Architecture

```
                ┌──────────────────────────────────────────────────────────────┐
                │  salishsea.knauernever.com                                   │
                │                                                              │
   browser ───▶ │  /admin/*               served by Vercel (the SPA)           │
                │  /api/admin/categories  rewritten to → Cloud Function        │
                └─────────────┬────────────────────────────────────────────────┘
                              ▼
              ┌───────────────────────────────────────────────┐
              │  admin-config Cloud Function (us-west1)       │
              │    GET  → returns current tree from GCS       │
              │    POST → validates token + payload, writes   │
              │    POST?verify=1 → checks token only          │
              └─────────────┬─────────────────────────────────┘
                            ▼
              ┌──────────────────────────────────────────┐
              │  gs://salish-ndvi-tiles/                 │
              │     config/category-tree.json            │
              │     config/site-content.json             │
              │     (public read, function-only write)   │
              └──────────────────────────────────────────┘
```

The public map and the admin tool **both** read the category tree (and site content) from the same public GCS URLs — no extra auth needed for reads, and changes flow to the map automatically on its next page load. Writes are funneled through the Cloud Function, which is the only writer to the files.

### Category Tree data model

Stored at `gs://salish-ndvi-tiles/config/category-tree.json`:

```json
{
  "version": 8,
  "updated_at": "2026-05-17T18:58:46Z",
  "tree": [
    {
      "id": "friends-data",
      "label": "Friends of the San Juans",
      "layers": ["friends-herring-spawning", "friends-bull-kelp", "..." ],
      "children": []
    },
    { "id": "fish-habitat", "label": "Fish Habitat", "layers": [...], "children": [] }
  ]
}
```

**Field rules:**

| Field | Notes |
|---|---|
| `id` | Stable slug (`^[a-z0-9-]+$`, max 64 chars). For a newly added category, the slug regenerates from the label as the admin types — until the first successful save, when it **locks forever**. After that, only the label can be edited. |
| `label` | Human-readable name shown in the sidebar. 1–120 chars. Editable any time. |
| `layers` | Layer ids (from `src/config/layers.ts`) assigned to this category. Same layer id can appear in multiple categories — the layer will then show up in multiple sidebar groups. |
| `children` | Recursive; empty array for leaf categories. A node can be both a branch and a leaf (have layers AND children). |
| Order | The array order = the visual order. No separate `order` field. |
| `version` / `updated_at` | Server-managed. Every successful POST bumps `version` and refreshes `updated_at`. The client's copy of these is ignored. |

### Category Tree Editor — features

Lives at [`src/components/Admin/CategoryTreeEditor.tsx`](src/components/Admin/CategoryTreeEditor.tsx). Built on `react-arborist`.

- **Drag-and-drop** to reorder or nest categories. Drop onto a row to nest under it; drop between rows to reorder.
- **Inline rename** on double-click. Enter to save, Escape to cancel. Spaces and other text editing keys are isolated from react-arborist's keyboard shortcuts.
- **Add root** / **Add child** buttons. Newly added rows auto-focus their label input. The slug shown next to a fresh row tracks whatever you're typing; after the next Save, the slug locks.
- **Delete** with safeguards: a category cannot be deleted while it has children or assigned layers. An explanatory alert tells the admin why.
- **Layer assignment panel** (right side). Click any category row → the right panel lists every available data layer with a checkbox. Tick to assign, untick to remove. Search filters the list. A `+N` indicator next to a layer means it's also assigned to N other categories.
- **Dirty-state Save / Discard** buttons appear only when local edits diverge from the server copy.
- **Orphan warning** at the top: layers defined in code that aren't assigned to any category. They won't appear in the public sidebar until assigned.
- **Empty-category warning** at the top: categories with no layers (directly or via descendants). They also won't appear in the public sidebar.
- **Concurrency model:** last-write-wins. Two admins editing the same tree simultaneously won't see a conflict warning; whoever saves second wins. Acceptable for v1's small admin team. The Cloud Function can be extended later to refuse a write whose `version` is stale.

### Landing Page Intro editor

Lives at [`src/components/Admin/LandingIntroEditor.tsx`](src/components/Admin/LandingIntroEditor.tsx). Built on [TipTap](https://tiptap.dev) (`@tiptap/react` + `@tiptap/starter-kit`).

- Edits the **welcome box** that floats at the top center of the map on the landing page (`/` only — not on `/view/*` preset embeds). Rendered by [`src/components/Map/LandingIntro.tsx`](src/components/Map/LandingIntro.tsx).
- **Light formatting only:** bold, italic, underline, one heading level, bulleted / numbered lists, links, undo / redo. The toolbar and the server allowlist are kept in lockstep — anything else is stripped on save.
- **Live preview** on the right reuses the exact `LandingIntroCard` component the map renders, so what admins see is what visitors get.
- **Dirty-state Save / Discard**, same pattern as the category editor. Empty content hides the box entirely.
- Visitors can **dismiss** the box; the dismissal is remembered per browser tab (`sessionStorage`) and a small "About this map" pill brings it back.
- Content is fetched by the map from the public GCS URL at startup (`src/services/siteContent.ts`, same cache/fallback pattern as `categoryTree.ts`). Saved changes appear on the map's next page load.

**Data model** — `gs://salish-ndvi-tiles/config/site-content.json`:

```json
{
  "version": 3,
  "updated_at": "2026-09-01T18:02:11Z",
  "landing_intro": { "html": "<h3>Welcome…</h3><p>…</p>" }
}
```

`html` is sanitized server-side with [`nh3`](https://github.com/messense/nh3) to this allowlist: `p br strong b em i u s a ul ol li h3 h4`; `<a>` may carry `href` (http/https/mailto only), `title`, `target`, and always gets `rel="noopener noreferrer"`. Max 20,000 characters. The document is designed to grow — additional keyed blocks (e.g. a future `about_page`) can be added alongside `landing_intro`.

### Cloud Function spec — `admin-config`

Code: [`cloud-functions/admin-config/main.py`](cloud-functions/admin-config/main.py)

One function, two documents, switched on the request path (`/` = category tree, `/content` = site content). Both paths support the same method set:

| Method | Behavior |
|---|---|
| `GET` | Returns the current document from GCS. Public; no auth. CORS for `salishsea.knauernever.com`, `localhost:5173`, `localhost:4173`. |
| `POST ?verify=1` | Validates `X-Admin-Token`; returns `204` on match, `401` on mismatch. No write side effects. Used by `AuthGate`. |
| `POST` | Full save: validates token, JSON-schema-validates the payload (tree: id uniqueness; content: HTML sanitization), server-bumps `version` and `updated_at`, writes the JSON to GCS with `Cache-Control: no-cache, max-age=0` and refreshes the public-read ACL. |
| `OPTIONS` | CORS preflight. |

Deploy (env vars `ADMIN_PASSWORD` / `GCS_BUCKET` persist across redeploys):

```bash
gcloud functions deploy admin-config --gen2 --region us-west1 --project salish-sea-property-mapper \
  --runtime python311 --entry-point admin_config --trigger-http --allow-unauthenticated \
  --source cloud-functions/admin-config --memory 256M
```

**Validation rules** (jsonschema + custom checks):
- Each node: `{ id, label, layers, children }`, all required except `layers` (defaults to `[]` if missing).
- `id`: matches `^[a-z0-9-]+$`, 1–64 chars.
- `label`: 1–120 chars.
- `layers`: array of slug-shaped strings, deduplicated within a node.
- `children`: recursive.
- All `id` values across the entire tree must be unique. Duplicates are rejected with a descriptive `400` listing them.

**Service account:** the function runs as `643709945717-compute@developer.gserviceaccount.com` with `roles/storage.objectAdmin` scoped to `gs://salish-ndvi-tiles`. This is the only identity allowed to write to the tree file.

### Layer info panels & legends

Every layer row has an **ⓘ** button. The panel it opens shows the layer **title**, a plain-language description (`standardMessage` — for the Friends layers this is the text from the Friends "Shoreline Map Set Descriptions" handout), a **Source:** line (`sourceCredit`), and an optional "Learn more" link (`sourceUrl`). Layers styled by attribute can declare a categorical `legend` (`{ type: 'categories', items: [{ label, color, shape? }] }`) that renders as swatches under the row while the layer is on; raster layers use the existing `gradient` legend. All of this lives in [`src/config/layers.ts`](src/config/layers.ts).

### Adding a new admin module (future)

The shell is built to grow. To add another admin module (say, "Layers"):

1. Add a route under `/admin/*` in [`src/main.tsx`](src/main.tsx).
2. Add an entry to the `MODULES` array in [`src/components/Admin/AdminShell.tsx`](src/components/Admin/AdminShell.tsx).
3. Build the module component under `src/components/Admin/`.
4. If it needs a backend, add the endpoint either as another Cloud Function with a matching Vercel rewrite (`/api/admin/<name>`) or extend the existing `admin-config` function with a sub-path — the `/content` route is the model: add a rewrite in `vercel.json`, a proxy entry in `vite.config.ts`, and a `_handle_<name>` branch in `main.py`.

The pattern is intentional: each admin module is independent, all share the same auth gate, and all backend traffic goes through the same `/api/admin/*` namespace on the user's own domain.

### Local development

The `dev` server proxies `/api/admin/categories` and `/api/admin/content` to the deployed Cloud Function automatically (configured in [`vite.config.ts`](vite.config.ts)). Query strings (e.g. `?verify=1`) survive the proxy. This means signing in to `/admin` locally hits the *real* deployed function — there's no separate local mock.

If you want to test against a different password, deploy the function with a new `ADMIN_PASSWORD` env var (`gcloud functions deploy admin-config --update-env-vars ADMIN_PASSWORD=...`). The function and the admin UI both read it from the same place: the deployed env.

---

## NDVI / Vegetation Analysis

### NAIP Layer (High Resolution)
| Property | Value |
|---|---|
| Source | USDA National Agriculture Imagery Program (NAIP DOQQ) |
| Date | October 2023 |
| Resolution | 0.6 meters (individual tree level) |
| Bands | 4-band RGBN (Red, Green, Blue, Near-Infrared) |
| NDVI Formula | (NIR − Red) / (NIR + Red) |
| Tile URL | `https://storage.googleapis.com/salish-ndvi-tiles/ndvi/{z}/{x}/{y}.png` |
| Zoom Range | 10–17 |
| GCS Bucket | `gs://salish-ndvi-tiles` (fine-grained ACLs, CORS enabled for `*`) |
| GEE Project | `salish-sea-property-mapper` (project #643709945717) |

### Sentinel-2 Layer (Seasonal)
| Property | Value |
|---|---|
| Source | ESA Copernicus Sentinel-2 (S2_SR_HARMONIZED) |
| Resolution | 10 meters |
| Revisit | Every 5 days |
| Processing | Cloud-free median composite via Google Earth Engine |
| Cloud Masking | SCL band classes 3 (shadow), 8 (cloud med), 9 (cloud high), 10 (cirrus) |
| NDVI Bands | B8 (NIR) and B4 (Red) |
| Date Picker | Spring/Summer/Fall seasonal steps, 2017–2025 |

### NDVI Color Palette (shared by both layers)
| Value Range | Color | Label |
|---|---|---|
| < 0 | `#d73027` (red) | Water / bare |
| 0 – 0.15 | `#fc8d59` (orange) | Sparse |
| 0.15 – 0.3 | `#fee08b` (yellow) | Low vegetation |
| 0.3 – 0.45 | `#d9ef8b` (lime) | Moderate |
| 0.45 – 0.6 | `#66bd63` (green) | Healthy |
| 0.6 – 0.75 | `#1a9850` (forest) | Dense |
| > 0.75 | `#006837` (dark green) | Very dense |

### Per-Parcel Statistics (`ndvi_parcel_stats.json`)
Pre-computed from NAIP imagery. Each of the 19,020 parcels has: `mean`, `stdDev`, `water`, `bare`, `sparse`, `moderate`, `dense`, `veryDense` (all as percentages of parcel area).

---

## Cloud Functions

Four HTTP-triggered functions, all in `us-west1`.

| Function | Source | Purpose |
|---|---|---|
| `ee-ndvi-tiles` | [`cloud-functions/ee-tiles/`](cloud-functions/ee-tiles/) | Computes Sentinel-2 NDVI tile URLs on demand. Public. See below. |
| `hansen-forest-change` | [`cloud-functions/hansen-forest-change/`](cloud-functions/hansen-forest-change/) | Returns a tile URL visualizing UMD Hansen Global Forest Change loss-by-year for San Juan County. Public; no parameters. |
| `opera-dist-alert` | [`cloud-functions/opera-dist-alert/`](cloud-functions/opera-dist-alert/) | Returns a tile URL for the OPERA L3 DIST-ALERT near-real-time vegetation disturbance product (GLAD mirror). Public; `?mode=recency\|status\|severity` for tiles, `?lat=&lng=` for per-pixel info. |
| `admin-config` | [`cloud-functions/admin-config/`](cloud-functions/admin-config/) | Reads / writes the category tree. Writes require `X-Admin-Token`. See [Admin Tool](#admin-tool). |

### Sentinel-2 NDVI Tile Server

**Location:** `cloud-functions/ee-tiles/main.py`

**Endpoint:** `GET https://us-west1-salish-sea-property-mapper.cloudfunctions.net/ee-ndvi-tiles/get-tiles`

**Query Parameters:**
| Param | Example | Description |
|---|---|---|
| `start` | `2024-06-01` | Start date (ISO 8601) |
| `end` | `2024-08-31` | End date (ISO 8601) |

**Response:**
```json
{ "tileUrl": "https://earthengine.googleapis.com/v1/.../{z}/{x}/{y}" }
```

**How it works:**
1. Lazily initializes Earth Engine with default credentials
2. Filters `COPERNICUS/S2_SR_HARMONIZED` by date range, San Juan County bbox, and < 30% cloud cover
3. Masks clouds via SCL band
4. Computes median composite, then NDVI from B8/B4
5. Returns a tile URL with the shared NDVI color palette

**Dependencies:** `functions-framework`, `earthengine-api`, `flask`, `google-auth`

### OPERA DIST-ALERT Tile Server

**Location:** `cloud-functions/opera-dist-alert/main.py`

**Endpoint:** `GET https://us-west1-salish-sea-property-mapper.cloudfunctions.net/opera-dist-alert`

Two modes share the same endpoint, switched by query params:

#### Tile-URL mode (no `lat`/`lng`)
| Param | Values | Default | Description |
|---|---|---|---|
| `mode` | `recency`, `status`, `severity` | `recency` | Which DIST-ALERT band + palette to render. |

**Response:** `{ "tileUrl": "https://earthengine.googleapis.com/v1/.../{z}/{x}/{y}" }`

#### Point-query mode (`?lat=<lat>&lng=<lng>`)
Used by the click-to-info popup. Samples all three DIST-ALERT bands at the click point and computes the connected disturbed patch containing that point (8-neighbor, capped at 1024 pixels ≈ 230 acres).

**Response:**
```json
{
  "date": "2026-05-13",            // ISO date of the alert (null if no disturbance here)
  "statusCode": 2,                  // raw VEG-DIST-STATUS code (0 if no disturbance)
  "statusLabel": "Confirmed alert (first detection)",
  "severity": 31,                   // percent vegetation loss
  "pixelCount": 18,                 // size of the connected patch
  "acres": 4.0,
  "truncated": false,               // true if pixelCount hit the 1024 cap
  "patchGeometry": { ... }          // GeoJSON polygon outlining the patch
}
```
For undisturbed pixels: returns `{ "date": null, "statusCode": 0, "statusLabel": null }`.

**How it works (tile mode):**
1. Lazily initializes Earth Engine with default credentials
2. Mosaics the appropriate band ImageCollection from `projects/glad/HLSDIST/current/` over the San Juan County bbox
   - `recency`  → `VEG-DIST-DATE` (days since 2020-12-31), painted dark-red → bright-red as recency increases
   - `status`   → `VEG-DIST-STATUS` (provisional vs. confirmed, first vs. ongoing) with a categorical 1–6 palette
   - `severity` → `VEG-ANOM-MAX` (0–100 % vegetation loss) with a yellow → red ramp
3. Returns the visualized tile URL

GLAD's published collections expose their data as a single `b1` band per per-band collection and **carry no `system:time_start`** — `filterDate()` is intentionally absent from the mosaic. GLAD refreshes `current/` in place as new HLS scenes arrive, so freshness is handled upstream.

**Frontend integration (click-to-info):**
- `src/components/Map/DistAlertPopup.tsx` — map-level click listener; standalone InfoWindow with date / status / severity / acres
- `src/components/Map/FeaturePopup.tsx → runDistAlertQuery()` — injects a "Disturbance alert" card into the property popup when the layer is visible
- `src/components/Map/featureHighlight.ts` — shared orange polygon outline (used by both DIST-ALERT and Hansen)
- Both standalone popups (`ForestLossPopup`, `DistAlertPopup`) draw a thin orange "neck" line via a `google.maps.Marker` SVG icon to connect the popup to the clicked pixel without obscuring it

**Why a separate function from `hansen-forest-change`:** Hansen is an annual cumulative product (the "what's the historical loss footprint" view); DIST-ALERT is the near-real-time companion (continuously updated by GLAD since 2023). They're surfaced together in the **Ecological** category as complementary layers and use parallel click handlers so a user can have either or both on at once.

**Source:** [GLAD viewer](https://glad.earthengine.app/view/dist-alert) (script source decompiled to resolve `projects/glad/HLSDIST/current/`). Upstream is [NASA OPERA L3 DIST-ALERT HLS V1](https://www.earthdata.nasa.gov/data/catalog/lpcloud-opera-l3-dist-alert-hls-v1-1). The GLAD mirror exposes one ImageCollection per band rather than a single multi-band collection.

**Dependencies:** `functions-framework`, `earthengine-api`, `flask`, `google-auth`

---

## Theming & Styling

### PNW Color Palette

Defined via Tailwind CSS v4 `@theme` directive in `src/index.css`:

| Token | Hex | Usage |
|---|---|---|
| `deep-teal` | `#0D4F4F` | Primary buttons, accents, links |
| `deep-teal-light` | `#1A7A7A` | Hover states |
| `slate-blue` | `#2C3E50` | Headers, body text |
| `slate-blue-light` | `#34495E` | Secondary text |
| `fog-gray` | `#E8ECEF` | Backgrounds, light surfaces |
| `fog-gray-dark` | `#CED4DA` | Borders, dividers |
| `forest-green` | `#1B4332` | Ecological context |
| `forest-green-light` | `#2D6A4F` | Lighter ecological |
| `driftwood` | `#D4A574` | Warm accent |
| `ocean-blue` | `#1A6B8A` | Secondary accent |
| `sand` | `#F5F1EB` | Light beige background |
| `kelp` | `#3D5A3E` | Dark green accent |

### Typography
**Font:** Source Sans 3 (Google Fonts) with `ui-sans-serif, system-ui, sans-serif` fallback. Antialiased rendering.

### Animations
- `slide-in-right` — 0.3 s ease-out for the PropertyReport panel

---

## Project Structure

```
salish-sea-propmapper/
├── cloud-functions/
│   ├── ee-tiles/
│   │   ├── main.py              # Sentinel-2 NDVI Cloud Function
│   │   └── requirements.txt
│   ├── hansen-forest-change/
│   │   ├── main.py              # Hansen Forest Change tile server (lossyear visualization)
│   │   └── requirements.txt
│   ├── opera-dist-alert/
│   │   ├── main.py              # OPERA DIST-ALERT tile server (recency / status / severity)
│   │   └── requirements.txt
│   └── admin-config/
│       ├── main.py              # Category tree read/write endpoint (admin tool backend)
│       └── requirements.txt
├── scripts/
│   ├── generate-preset-html.ts  # Build-time per-preset HTML generator (runs after vite build)
│   └── seed-category-tree.json  # One-time seed for gs://salish-ndvi-tiles/config/category-tree.json
├── public/
│   └── data/
│       ├── Tax_Parcels.geojson         # 133 MB, 19K parcels
│       ├── Building_Footprints.geojson # 17 MB, 31K buildings
│       ├── Stormwater_Pipes.geojson    # 1.9 MB, 1.8K pipes
│       ├── chinook-salmon.geojson      # 5.2 MB each (×7 species)
│       ├── chum-salmon.geojson
│       ├── pink-salmon.geojson
│       ├── pacific-herring.geojson
│       ├── pacific-sand-lance.geojson
│       ├── surf-smelt.geojson
│       ├── lingcod-greenling.geojson
│       ├── address_lookup.json         # PIN → address records
│       └── ndvi_parcel_stats.json      # Per-parcel NDVI stats
├── src/
│   ├── components/
│   │   ├── Admin/
│   │   │   ├── AuthGate.tsx            # Login screen + sessionStorage token (verifies against the function)
│   │   │   ├── AdminShell.tsx          # Header + module nav layout used by all /admin routes
│   │   │   └── CategoryTreeEditor.tsx  # Drag-drop tree + layer assignment panel (react-arborist)
│   │   ├── Layout/
│   │   │   ├── Header.tsx              # Top bar with branding + search
│   │   │   └── Sidebar.tsx             # Slide-out layer controls panel
│   │   ├── Map/
│   │   │   ├── MapContainer.tsx        # Google Maps init + context provider
│   │   │   ├── FeaturePopup.tsx        # Tabbed parcel popup (Summary/Property/Buildings/Shoreline)
│   │   │   ├── LayerControls.tsx       # Layer toggles, opacity, date picker
│   │   │   └── RadiusOverlay.tsx       # Search radius circle + marker
│   │   ├── Report/
│   │   │   ├── PropertyReport.tsx      # Slide-in spatial query results
│   │   │   ├── ReportSection.tsx       # Collapsible per-layer result section
│   │   │   └── AskAI.tsx              # Placeholder for AI summary feature
│   │   ├── Search/
│   │   │   └── AddressSearch.tsx       # Google Places Autocomplete input
│   │   └── common/
│   │       ├── Toggle.tsx              # Accessible switch component
│   │       ├── Badge.tsx               # Count badge (default/muted/accent)
│   │       └── LoadingState.tsx        # Spinner and overlay components
│   ├── config/
│   │   ├── layers.ts                   # Layer definitions (20 layers)
│   │   └── presets.ts                  # Preset view definitions (see Preset Views)
│   ├── hooks/
│   │   ├── useMap.ts                   # MapContext consumer
│   │   ├── useGeocode.ts              # Geocoding wrapper
│   │   ├── useLayers.ts              # Layer loading, visibility, interaction
│   │   └── useSpatialQuery.ts        # Spatial query orchestration
│   ├── services/
│   │   ├── spatial.ts                 # Turf.js spatial query engine
│   │   ├── popupSpatial.ts           # Building count + shoreline habitat queries
│   │   ├── geocode.ts                # Google Geocoder wrapper
│   │   └── categoryTree.ts           # Live-from-GCS category tree (with baked-in fallback)
│   ├── types/
│   │   └── index.ts                   # TypeScript interfaces
│   ├── utils/
│   │   └── geojson.ts                 # Fetch, Z-strip, property extraction, labeling
│   ├── App.tsx                        # Root component + event bridge
│   ├── index.css                      # Tailwind @theme, global styles, animations
│   └── main.tsx                       # React DOM entry point
├── .env.example
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── vite.config.ts
├── vercel.json                  # SPA catch-all rewrite (filesystem precedence keeps per-preset HTML wins)
├── PRESET_VIEWS_PLAN.md         # Design notes for the preset views system
└── eslint.config.js
```

---

## Dependencies

### Runtime
| Package | Version | Purpose |
|---|---|---|
| `react` | 19.2.0 | UI framework |
| `react-dom` | 19.2.0 | DOM renderer |
| `react-router-dom` | 7.x | Client-side routing for preset views and `/admin/*` |
| `react-arborist` | 3.x | Tree UI (drag-drop reorder/nest) used by the Category Tree Editor |
| `@googlemaps/js-api-loader` | 2.0.2 | Google Maps API loading |
| `@turf/turf` | 7.3.4 | Geospatial analysis (buffer, intersect, bbox, point-in-polygon) |
| `tailwindcss` | 4.1.18 | Utility-first CSS framework |
| `@tailwindcss/vite` | 4.1.18 | Tailwind CSS Vite integration |

### Development
| Package | Version | Purpose |
|---|---|---|
| `typescript` | 5.9.3 | Type checking |
| `vite` | 7.3.1 | Build tool + dev server |
| `@vitejs/plugin-react` | 4.x | React Fast Refresh for Vite |
| `eslint` | 9.x | Linting |
| `tsx` | 4.x | Runs the preset HTML generator script as part of `npm run build` |
| `@types/google.maps` | 3.64+ | Type definitions for Google Maps (incl. `PlaceAutocompleteElement`) |

---

## Lessons Learned

### Google Maps API (`@googlemaps/js-api-loader` v2)

- **Initialization**: Use `APILoader.setOptions({ key, v: 'weekly' })` + `importLibrary()` — NOT `new Loader()`. The v2 API uses static methods.
- **Option names**: `key` (not `apiKey`), `v` (not `version`).
- **AdvancedMarkerElement**: Must `importLibrary('marker')` first and store the class in a ref. It is not available on `google.maps` directly.
- **PlaceAutocompleteElement** works with js-api-loader v2 *if* you wait for the custom element to register before constructing it. The minimal recipe:
    ```ts
    await importLibrary('places');
    await customElements.whenDefined('gmp-place-autocomplete');
    const el = new google.maps.places.PlaceAutocompleteElement({ /* options */ });
    ```
    Earlier "Illegal constructor" errors came from constructing synchronously before the element class was registered.
- **New Places API is a separate product from classic Places API.** `PlaceAutocompleteElement` requires "Places API (New)" to be enabled in Google Cloud and listed in the key's API restrictions. The classic "Places API" is not used by this project.
- **`includedPrimaryTypes` is stricter in the new Places API** — the legacy `'address'` category is not a valid value. Either omit the filter or use specific types like `street_address`, `premise`. The current implementation uses no type filter, just `locationBias` to softly prefer San Juan County.
- **`locationBias` vs `locationRestriction`** — bias is a soft preference (results outside the bounds still appear, ranked lower); restriction is a hard filter (results outside are excluded entirely). The current implementation uses bias so users can search any US address.
- **Event handling on `PlaceAutocompleteElement`** — listen for `gmp-select`; the event is `PlacePredictionSelectEvent`. Convert to a `Place` via `event.placePrediction.toPlace()`, then `await place.fetchFields({ fields: [...] })` to lazily resolve the values you need.
- **Always verify against Google's official docs** — the Maps JavaScript API surface area is large and inconsistently documented across versions.

### Routing / SPA Hosting

- **Per-route HTML on Vercel** — Vercel resolves filesystem matches *before* applying rewrites. Generating `dist/view/{name}/index.html` files at build time gives social crawlers correct per-URL `<meta>` tags while a single SPA bundle still handles client-side rendering. A catch-all rewrite (`/(.*)` → `/index.html`) covers any URL that doesn't have a real file.
- **`tsx` for build-time scripts** — Avoids a separate `node-fetch-tsc` build step. The HTML generator imports `src/config/presets.ts` directly, which means presets and HTML stay in sync without code generation.
- **Different element types for different routes** — `<Route path="/" element={<App />} />` vs. `<Route path="/view/:name" element={<PresetView />} />` ensures React unmounts/remounts cleanly when navigating between preset and default routes. That gives a free state reset (map remounts with fresh hooks), which is the desired behavior for "View full map".

### GeoJSON & Spatial Operations

- **3D coordinates**: `Tax_Parcels.geojson` includes Z coordinates (`[lng, lat, 0.0]`). Turf.js does not handle 3D coordinates — strip Z values before any spatial operation.
- **Viewport filtering**: For large layers (19K+ parcels), pre-compute feature bounding boxes and only render features visible in the current map viewport. Keep the full dataset in memory for spatial queries.
- **Bbox pre-filter**: Always filter by bounding box before running `turf.booleanIntersects()`. The bbox check is O(1) per feature vs. O(n) for full polygon intersection.

### Google Earth Engine & Cloud Storage

- **GCS bucket ACLs**: Earth Engine tile exports require **fine-grained ACLs** on the target GCS bucket. Uniform bucket-level access will not work.
- **CORS**: The GCS bucket must have CORS configured (allowed origin: `*`) for the browser to fetch tiles.
- **gcloud CLI**: Installed at `/opt/homebrew/share/google-cloud-sdk/bin/gcloud`; requires `CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.13`.
- **Lazy EE initialization**: The Cloud Function initializes Earth Engine on first request to avoid cold-start overhead on subsequent invocations.

### Rendering & Performance

- **Separate `google.maps.Data` instances per layer** — avoids style conflicts and allows independent visibility toggling.
- **Raster layers via `ImageMapType`** — insert at `overlayMapTypes[0]` so they render below vector features. Toggle visibility by setting opacity to 0 rather than removing/re-adding.
- **Polygon donut masking** — to clip NDVI imagery to a parcel shape in the mini-map, use a `google.maps.Polygon` with a bounded outer rectangle (not world-spanning) and the parcel ring as a hole. Explicitly enforce winding order (CW outer, CCW inner).

### UI Patterns

- **Custom event bridge** — use `CustomEvent` dispatch/listen for cross-component communication (e.g., clicking an address inside a popup triggers a new search) rather than deeply threaded callback props.
- **Async popup data** — parcel popups load address lookup and NDVI stats in parallel after opening. The popup renders immediately with loading placeholders, then fills in as data arrives.
- **Show ALL properties** — for GeoJSON feature popups, display every property from the data (not just a curated subset). Hide only internal/system fields (OBJECTID, Shape_Length, RuleID, etc.).
