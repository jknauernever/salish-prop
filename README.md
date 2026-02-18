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
- Google Places Autocomplete biased to San Juan County bounds (48.40–48.85 lat, -123.25 to -122.75 lng)
- Searches restricted to address-type results
- Selecting an address zooms the map, runs a spatial query, and opens a property popup on the containing parcel

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
  - Places API
  - Geocoding API
- A **Map ID** configured for the Maps JavaScript API (required for AdvancedMarkerElement)

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
npm run build    # TypeScript check + Vite build → dist/
npm run preview  # Serve the production build locally
```

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

### Ecological (5 layers)
| Layer | Type | Source | Notes |
|---|---|---|---|
| Vegetation Health (NDVI) | Raster (static) | GCS bucket, NAIP Oct 2023 | 0.6 m resolution, zoom 10–17 |
| Sentinel-2 NDVI (10 m) | Raster (dynamic) | Earth Engine Cloud Function | Seasonal date picker, zoom 10+ |
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
│   └── ee-tiles/
│       ├── main.py              # Sentinel-2 NDVI Cloud Function
│       └── requirements.txt
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
│   │   └── layers.ts                   # Layer definitions (20 layers)
│   ├── hooks/
│   │   ├── useMap.ts                   # MapContext consumer
│   │   ├── useGeocode.ts              # Geocoding wrapper
│   │   ├── useLayers.ts              # Layer loading, visibility, interaction
│   │   └── useSpatialQuery.ts        # Spatial query orchestration
│   ├── services/
│   │   ├── spatial.ts                 # Turf.js spatial query engine
│   │   ├── popupSpatial.ts           # Building count + shoreline habitat queries
│   │   └── geocode.ts                # Google Geocoder wrapper
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
└── eslint.config.js
```

---

## Dependencies

### Runtime
| Package | Version | Purpose |
|---|---|---|
| `react` | 19.2.0 | UI framework |
| `react-dom` | 19.2.0 | DOM renderer |
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

---

## Lessons Learned

### Google Maps API (`@googlemaps/js-api-loader` v2)

- **Initialization**: Use `APILoader.setOptions({ key, v: 'weekly' })` + `importLibrary()` — NOT `new Loader()`. The v2 API uses static methods.
- **Option names**: `key` (not `apiKey`), `v` (not `version`).
- **AdvancedMarkerElement**: Must `importLibrary('marker')` first and store the class in a ref. It is not available on `google.maps` directly.
- **PlaceAutocompleteElement**: UNRELIABLE with js-api-loader v2 — the `importLibrary('places')` call does not properly register the custom element, causing `"Illegal constructor"` errors. Use the legacy `google.maps.places.Autocomplete` with a styled `<input>` element instead. The deprecation warning for legacy Autocomplete is harmless (only blocks accounts created after March 2025).
- **Always verify against Google's official docs** — the Maps JavaScript API surface area is large and inconsistently documented across versions.

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
