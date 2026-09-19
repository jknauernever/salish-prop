import type { LayerConfig } from '../types';
import { SHOREFORM_TYPES, SHOREFORM_GROUPS, SHOREFORM_GROUP_ORDER } from './shoreforms.js';
import { MARKER_ICONS, FRIENDS_PROJECT_ICONS, FRIENDS_PROJECT_COLORS } from './markerIcons.js'; // .js extension: this file is also loaded by the Node share function (ESM)
import { FISH_USE_LAYER_ID, FISH_USE_NAME, FISH_USE_SOURCE, FISH_USE_LEGEND, FISH_USE_POPUP_FIELDS, FISH_COLOR_MODES, FISH_TIERS } from './fishUse.js';

// Fish Use draws one shoreline line, colored by priority level for the chosen
// species (see config/fishUse.ts). This base style is what swatches and accents
// fall back to; the line itself takes its color and width from the level.
const FISH_USE_STYLE: LayerConfig['style'] = {
  fillColor: FISH_TIERS[2].color,
  fillOpacity: 0,
  strokeColor: FISH_TIERS[2].color,
  strokeWeight: FISH_TIERS[2].weight,
  zIndex: 4.5, // over the wide spawning-beach bands, under the thin geology and armor lines
};
const FISH_USE_CASING = { color: '#FFFFFF', weight: 9, opacity: 0.9 };

export const layerConfigs: LayerConfig[] = [
  // === Property Layers ===
  {
    id: 'tax-parcels',
    name: 'Properties',
    description: 'Property boundaries from San Juan County Assessor',
    standardMessage: 'County tax parcel boundaries with assessor attributes (ownership, use, valuation, sale history). Click a parcel for its property report.',
    category: 'property',
    source: 'https://storage.googleapis.com/salish-ndvi-tiles/data/Tax_Parcels.geojson',
    visible: true,
    style: {
      fillColor: '#ADB5BD',
      fillOpacity: 0.05,
      strokeColor: '#F97316',
      strokeWeight: 1.2,
    },
    popupFields: [
      { key: 'PIN', label: 'Parcel ID' },
      { key: 'Short_Lega', label: 'Legal Description' },
      { key: 'Acres', label: 'Acres' },
      { key: 'Tax_Area', label: 'Tax Area' },
      { key: 'Land_Value', label: 'Land Value' },
      { key: 'Appraised_', label: 'Appraised Value' },
      { key: 'Bldg_Value', label: 'Building Value' },
      { key: 'Use_Code', label: 'Use Code' },
      { key: 'Descriptio', label: 'Description' },
      { key: 'Sale_date', label: 'Last Sale Date' },
      { key: 'Sale_Price', label: 'Last Sale Price' },
    ],
    minZoom: 13.5,
    // Rendered from vector tiles (deck.gl); the 133 MB GeoJSON is no longer downloaded.
    // Per-parcel detail comes from storage.googleapis.com/salish-ndvi-tiles/parcels/<FID>.json
    tiles: { url: 'https://storage.googleapis.com/salish-ndvi-tiles/tiles/parcels/{z}/{x}/{y}.pbf', sourceLayer: 'parcels', minZoom: 13, maxZoom: 16 },
    sourceCredit: 'San Juan County GIS (Assessor parcel data)',
  },
  {
    id: 'building-footprints',
    name: 'Building Footprints',
    description: 'Building footprints across San Juan County',
    standardMessage: 'Building outlines across San Juan County.',
    category: 'property',
    source: '/data/Building_Footprints.geojson',
    visible: true,
    style: {
      fillColor: '#60A5FA',
      fillOpacity: 0.7,
      strokeColor: '#1A252F',
      strokeWeight: 0.8,
    },
    popupFields: [
      { key: 'ADDRESS', label: 'Address' },
      { key: 'Sq_Ft', label: 'Footprint (sq ft)' },
      { key: 'Island', label: 'Island' },
      { key: 'PIN', label: 'Parcel PIN' },
      { key: 'Discriptio', label: 'Description' },
      { key: 'Source', label: 'Data Source' },
    ],
    minZoom: 15,
    tiles: { url: 'https://storage.googleapis.com/salish-ndvi-tiles/tiles/buildings/{z}/{x}/{y}.pbf', sourceLayer: 'buildings', minZoom: 14, maxZoom: 16 },
    sourceCredit: 'San Juan County GIS',
  },

  // === Planning Layers ===
  {
    id: 'stormwater-pipes',
    gpu: true,
    name: 'Stormwater Infrastructure',
    description: 'County stormwater pipe network',
    category: 'planning',
    source: '/data/Stormwater_Pipes.geojson',
    visible: false,
    minZoom: 15,
    casing: { color: '#93C5FD', weight: 7.5, opacity: 0.9 },
    markerScale: 0.75, // minor structures
    markerIcon: MARKER_ICONS.drain, // pins on pipe midpoints; culverts are ~12 m each, so keep thinning at every zoom
    markerAlwaysThin: true,
    style: {
      fillColor: '#1D4ED8',
      fillOpacity: 0,
      strokeColor: '#1D4ED8', // dark blue pipe over a light blue casing (see casing)
      strokeWeight: 3.5,
    },
    popupFields: [
      { key: 'Pipe_ID', label: 'Pipe ID' },
      { key: 'Diameter', label: 'Diameter (in)' },
      { key: 'Material', label: 'Material' },
      { key: 'Length', label: 'Length (ft)' },
      { key: 'Pipe_Class', label: 'Class' },
      { key: 'Island', label: 'Island' },
      { key: 'Status', label: 'Status' },
      { key: 'Instl_Year', label: 'Install Year' },
    ],
    standardMessage: 'Stormwater infrastructure carries runoff from roads and developed areas to nearby water bodies. Pollutants in stormwater—oils, heavy metals, nutrients—can degrade nearshore habitat quality for salmon, forage fish, and shellfish.',
    whyItMatters: {
      text: 'Stormwater that runs off the land (runoff) carries sediments, debris, and pollutants like fecal coliform bacteria, petroleum, and heavy metals directly to local waters. Individual and onsite efforts to control stormwater and the pollutants it carries are essential in San Juan County, as public infrastructure is extremely limited. You can help by maintaining or restoring native vegetation along the shore to slow and filter runoff, installing pervious walks and driveways to allow filtration, directing stormwater flow from gutters and roads into vegetated areas, maintaining onsite sewage systems, and using compost instead of chemical fertilizers.',
      source: { credit: 'Living with the Shoreline (Friends of the San Juans)', url: '/reports/living-with-the-shoreline.html' },
    },
    sourceCredit: 'San Juan County GIS',
  },

  // === Fish Habitat Layers ===
  {
    id: FISH_USE_LAYER_ID,
    name: FISH_USE_NAME,
    description: 'Fish use priority along the shoreline for juvenile salmon, forage fish, and greenlings and cods: how likely each is to be present and abundant, as moderate, high or highest priority',
    category: 'fish-habitat',
    source: FISH_USE_SOURCE,
    visible: true, // on by default (drawn from zoom 12), colored by juvenile Chinook until another species is chosen
    fishUse: true,
    gpu: true,
    minZoom: 12, // county-wide the thick priority line swamps everything else
    style: FISH_USE_STYLE,
    casing: FISH_USE_CASING,
    hitStrokeWeight: 14,
    legend: FISH_USE_LEGEND,
    // "Color by": one species, or the highest level among all seven (see config/fishUse.ts)
    visualizationModes: FISH_COLOR_MODES,
    popupFields: FISH_USE_POPUP_FIELDS,
    standardMessage: 'How likely juvenile salmon, forage fish, and greenlings and cods are to be present and abundant along each stretch of shoreline, from 1,350 beach seine sets at 80 sites across the San Juan Islands (high-resolution model). Friends of the San Juans groups the model scores into moderate, high and highest priority, as in the countywide salmon recovery prioritization. Salmon levels are for rearing juveniles. Nothing is ranked low: fish can and do use every shoreline. Choose which species colors the line; the hover label and popup list all seven.',
    infoItems: [
      { label: 'Juvenile Chinook', text: 'Chinook salmon are listed as threatened under the Endangered Species Act. Nearshore habitat is critical for juvenile Chinook rearing and migration. Shoreline modification can reduce prey availability and disrupt migration corridors.' },
      { label: 'Juvenile Chum', text: 'Chum salmon depend on nearshore habitats during early marine life stages. Estuaries and pocket beaches provide critical transition zones where juveniles feed and grow before moving offshore.' },
      { label: 'Juvenile Pink', text: 'Pink salmon are the most abundant Pacific salmon species. Their juveniles spend minimal time in freshwater, making nearshore marine habitat especially critical during outmigration.' },
      { label: 'Pacific herring', text: 'Pacific herring are a keystone forage fish species, spawning on eelgrass and algae in nearshore areas. Herring are a primary food source for salmon, seabirds, and marine mammals throughout the Salish Sea.' },
      { label: 'Surf smelt', text: 'Surf smelt spawn on mixed sand-gravel beaches in the upper intertidal zone. Like sand lance, their spawning habitat is directly threatened by shoreline hardening and development.' },
      { label: 'Pacific sand lance', text: 'Sand lance spawn in the upper intertidal zone on sand-gravel beaches. Shoreline armoring and beach modification directly destroy spawning habitat for this essential forage fish.' },
      { label: 'Greenlings and Cods', text: 'Lingcod and greenling use rocky nearshore habitats for spawning and juvenile rearing. Kelp forests and rocky reefs are essential for their life cycle.' },
    ],
    whyItMatters: {
      text: 'The San Juans are important rearing habitat for out-migrating juvenile salmon. Researchers have found juvenile salmon from twenty of the twenty two populations of threatened Puget Sound Chinook salmon (along with many other species and populations of young salmon) throughout the shallow waters of the San Juans. The time young salmon spend in the marine nearshore is critical to their ability to survive as adults. Shorelines with native vegetation, eelgrass, and kelp help young salmon feed, grow, and avoid predators as they migrate to the open ocean.',
      source: { credit: 'Living with the Shoreline (Friends of the San Juans)', url: '/reports/living-with-the-shoreline.html' },
    },
    whyItMattersByMode: {
      herring: { text: 'Herring, crucial for marine food webs, spawn on eelgrass habitat in just a few locations in San Juan County that are also popular with boaters including Eastsound and West Sound, Blind Bay, Mud Bay, and Hunter Bay. Eelgrass, a vital marine habitat in the Salish Sea, supports Dungeness crabs, Chinook salmon, Pacific herring, and ultimately the Southern Resident killer whales.', source: { credit: 'Become a Green Boater Today (sanjuans.org)', url: 'https://sanjuans.org/become-a-green-boater-today/' } },
      smelt: { text: 'Forage fish are small schooling fish that are eaten by larger fish, seabirds, and marine mammals. Forage fish are staples in the diets of Chinook and Coho salmon, lingcod, Marbled Murrelets, Rhinoceros Auklets, and Minke whales. Forage fish utilize the same shoreline areas that humans do, which makes them vulnerable to modifications such as bulkheads, docks, roads, and the removal of vegetation. A NOAA Fisheries study in northern Puget Sound found that surf smelt egg survival was reduced by 50% in places where the beach habitat was both warmer and drier as a result of the presence of hard armored bulkheads and the absence of trees and shrubs.', source: { credit: 'Living with the Shoreline (Friends of the San Juans)', url: '/reports/living-with-the-shoreline.html' } },
      'sand-lance': { text: 'Forage fish are small schooling fish that are eaten by larger fish, seabirds, and marine mammals. Forage fish are staples in the diets of Chinook and Coho salmon, lingcod, Marbled Murrelets, Rhinoceros Auklets, and Minke whales. Forage fish utilize the same shoreline areas that humans do, which makes them vulnerable to modifications such as bulkheads, docks, roads, and the removal of vegetation. A NOAA Fisheries study in northern Puget Sound found that surf smelt egg survival was reduced by 50% in places where the beach habitat was both warmer and drier as a result of the presence of hard armored bulkheads and the absence of trees and shrubs.', source: { credit: 'Living with the Shoreline (Friends of the San Juans)', url: '/reports/living-with-the-shoreline.html' } },
    },
    sourceCredit: 'Beamer & Fresh 2012, Skagit River System Cooperative (juvenile salmon and forage fish shoreline surveys, 2008–2009)',
  },
  {
    // Marbled murrelet is a seabird, not a fish, but WDFW's at-sea boat surveys
    // (MRB) and aerial surveys (PSEMP) produce stratum-level density estimates
    // analogous in shape to the fish-habitat layers, so the layer is grouped
    // with the marine wildlife datasets. Density values are stratum aggregates,
    // not point observations; the 30m raster products cataloged in
    // `public/data/wdfw_*_mosaic_catalog.json` are interpolated display
    // surfaces and are not rendered here. Coverage is US Salish Sea only —
    // does not extend into BC waters. Source: WDFW Wildlife Program; we will
    // need separate attribution + use permission (Scott Pearson group) before
    // public deployment.
    id: 'marbled-murrelet-breeding',
    name: 'Marbled Murrelet (Breeding Season)',
    description:
      'WDFW Marine Resident Seabird (MRB) boat-survey density estimates for marbled murrelet, May 15 – Jul 31. Stratum-aggregated; 3 strata × annual estimates 2001–2020.',
    category: 'fish-habitat',
    source: '/data/mamu_mrb_density_by_stratum_year.geojson',
    visible: false,
    style: {
      fillColor: '#B45309',
      fillOpacity: 0.25,
      strokeColor: '#92400E',
      strokeWeight: 1.5,
    },
    popupFields: [
      { key: 'StrataName', label: 'Stratum' },
      { key: 'latestYear', label: 'Latest Survey Year' },
      { key: 'EstBirds_latest', label: 'Estimated Birds' },
      { key: 'Lower_latest', label: '95% CI Lower' },
      { key: 'Upper_latest', label: '95% CI Upper' },
      { key: 'Density_latest', label: 'Density (birds/km²)' },
      { key: 'Density_CV_latest', label: 'Density CV' },
    ],
    standardMessage:
      'Marbled murrelets are listed as Threatened under the federal Endangered Species Act. These values are spring/summer at-sea density estimates from WDFW boat surveys (MRB), aggregated to large biogeographic strata — they represent abundance for the stratum as a whole, not the point you clicked. The companion 30m raster surfaces published by WDFW are interpolated display products, not raw observations.',
    whyItMatters: {
      text: 'From marbled murrelets to cormorants, seabirds rely on abundant fish, intact kelp forests, and undisturbed nesting areas.',
      source: { credit: 'Shoreline Ecosystems (sanjuans.org)', url: 'https://sanjuans.org/our-work/shoreline-ecosystems/' },
    },
    sourceCredit: 'Washington Department of Fish and Wildlife at-sea surveys (MRB)',
    sourceUrl:
      'https://geodataservices.wdfw.wa.gov/arcgis/rest/services/WP_WildlifeSurveys/MRB/MapServer',
  },
  {
    // Winter aerial counterpart to the MRB breeding layer. Same caveats:
    // stratum-aggregated, US Salish Sea only, raster surfaces are
    // interpolated. PSEMP Stats uses Median/Lower_90/Upper_90 (bootstrap CI)
    // rather than MRB's EstBirds/Lower/Upper (normal-CL CI).
    id: 'marbled-murrelet-winter',
    name: 'Marbled Murrelet (Winter)',
    description:
      'WDFW Puget Sound Ecosystem Monitoring Program (PSEMP) winter aerial-survey density estimates for marbled murrelet. Stratum-aggregated; 36 basins × annual estimates 1996–2024.',
    category: 'fish-habitat',
    source:
      'https://storage.googleapis.com/salish-ndvi-tiles/data/mamu_psemp_density_by_stratum_year.geojson',
    visible: false,
    style: {
      fillColor: '#475569',
      fillOpacity: 0.25,
      strokeColor: '#1E293B',
      strokeWeight: 1.5,
    },
    popupFields: [
      { key: 'StrataName', label: 'Basin' },
      { key: 'Depth_latest', label: 'Depth Stratum' },
      { key: 'sqkm', label: 'Basin Area (km²)' },
      { key: 'latestYear', label: 'Latest Survey Year' },
      { key: 'Median_latest', label: 'Median Estimate (birds)' },
      { key: 'Lower_90_latest', label: '90% CI Lower' },
      { key: 'Upper_90_latest', label: '90% CI Upper' },
      { key: 'Median_Density_latest', label: 'Median Density (birds/km²)' },
    ],
    standardMessage:
      'Marbled murrelets are listed as Threatened under the federal Endangered Species Act. These values are winter at-sea density estimates from PSEMP aerial surveys, aggregated to ~36 basins — they represent abundance for the basin as a whole, not the point you clicked. Confidence intervals are 90% bootstrap rather than 95% normal-CL, reflecting the distance-sampling methodology of the aerial program.',
    whyItMatters: {
      text: 'From marbled murrelets to cormorants, seabirds rely on abundant fish, intact kelp forests, and undisturbed nesting areas.',
      source: { credit: 'Shoreline Ecosystems (sanjuans.org)', url: 'https://sanjuans.org/our-work/shoreline-ecosystems/' },
    },
    sourceCredit: 'Washington Department of Fish and Wildlife / Puget Sound Ecosystem Monitoring Program (PSEMP) surveys',
    sourceUrl:
      'https://geodataservices.wdfw.wa.gov/arcgis/rest/services/WP_WildlifeSurveys/PSEMP/MapServer',
  },

  // === Ecological Layers ===
  {
    id: 'ndvi',
    name: 'Vegetation Health (NDVI)',
    description: 'Normalized Difference Vegetation Index derived from NAIP aerial imagery (Oct 2023, 0.6m resolution)',
    category: 'ecological',
    source: '',
    visible: false,
    style: {
      fillColor: '#1a9850',
      fillOpacity: 0,
      strokeColor: '#1a9850',
      strokeWeight: 0,
    },
    popupFields: [],
    standardMessage: 'NDVI measures vegetation density and health from aerial imagery. Green areas indicate healthy, dense vegetation; yellow indicates sparse or stressed vegetation; red indicates bare ground, water, or impervious surfaces.',
    whyItMatters: {
      text: 'Trees and shrubs do a lot of work. An undisturbed forest can intercept up to 40% of rainfall, protecting against erosion while also slowing surface runoff, increasing infiltration, and protecting water quality. Overhanging vegetation also provides shade, a key factor in keeping beach conditions cool, moist, and organically rich. The insects that live in the trees and shrubs then become food for small fish. Shoreline vegetation is feeding, nesting, roosting, breeding, and migratory habitat for hundreds of wildlife species including eagles, herons, and osprey.',
      source: { credit: 'Living with the Shoreline (Friends of the San Juans)', url: '/reports/living-with-the-shoreline.html' },
    },
    sourceCredit: 'USDA NAIP aerial imagery (October 2023, 0.6 m), processed in Google Earth Engine',
    layerType: 'raster',
    tileUrl: 'https://storage.googleapis.com/salish-ndvi-tiles/ndvi/{z}/{x}/{y}.png',
    defaultOpacity: 0.7,
    minZoom: 10,
  },
  {
    id: 'ndvi-sentinel',
    name: 'Sentinel-2 NDVI (10m)',
    description: 'Sentinel-2 derived NDVI at 10m resolution — select a date range to view seasonal vegetation change',
    category: 'ecological',
    source: '',
    visible: false,
    style: {
      fillColor: '#1a9850',
      fillOpacity: 0,
      strokeColor: '#1a9850',
      strokeWeight: 0,
    },
    popupFields: [],
    standardMessage: 'Sentinel-2 NDVI computed on-the-fly from cloud-free satellite composites. Use the date range controls to compare vegetation health across seasons and years.',
    whyItMatters: {
      text: 'Trees and shrubs do a lot of work. An undisturbed forest can intercept up to 40% of rainfall, protecting against erosion while also slowing surface runoff, increasing infiltration, and protecting water quality. Overhanging vegetation also provides shade, a key factor in keeping beach conditions cool, moist, and organically rich. The insects that live in the trees and shrubs then become food for small fish. Shoreline vegetation is feeding, nesting, roosting, breeding, and migratory habitat for hundreds of wildlife species including eagles, herons, and osprey.',
      source: { credit: 'Living with the Shoreline (Friends of the San Juans)', url: '/reports/living-with-the-shoreline.html' },
    },
    sourceCredit: 'ESA Copernicus Sentinel-2 (10 m), cloud-free seasonal composites processed in Google Earth Engine',
    layerType: 'dynamic-raster',
    apiEndpoint: 'https://us-west1-salish-sea-property-mapper.cloudfunctions.net/ee-ndvi-tiles',
    defaultOpacity: 0.7,
    minZoom: 10,
  },
  {
    id: 'forest-loss',
    name: 'Forest Loss (2001–2025)',
    description: 'Annual forest cover loss in San Juan County from the Hansen Global Forest Change dataset, derived from Landsat at 30m resolution.',
    category: 'ecological',
    source: '',
    visible: false,
    style: {
      fillColor: '#dc2626',
      fillOpacity: 0,
      strokeColor: '#dc2626',
      strokeWeight: 0,
    },
    popupFields: [],
    standardMessage: 'Annual forest cover loss from the UMD Hansen Global Forest Change dataset. Pixels are colored by the year the loss occurred — pale pink for early loss (2001), bright red for recent loss (2025). Source data is derived from Landsat at 30m resolution. Click any colored pixel for the loss patch size.',
    whyItMatters: {
      text: 'Trees and shrubs do a lot of work. An undisturbed forest can intercept up to 40% of rainfall, protecting against erosion while also slowing surface runoff, increasing infiltration, and protecting water quality. Overhanging vegetation also provides shade, a key factor in keeping beach conditions cool, moist, and organically rich. The insects that live in the trees and shrubs then become food for small fish. Shoreline vegetation is feeding, nesting, roosting, breeding, and migratory habitat for hundreds of wildlife species including eagles, herons, and osprey.',
      source: { credit: 'Living with the Shoreline (Friends of the San Juans)', url: '/reports/living-with-the-shoreline.html' },
    },
    sourceCredit: 'Hansen/UMD/Google/USGS/NASA Global Forest Change (Landsat, 30 m)',
    sourceUrl: 'https://developers.google.com/earth-engine/datasets/catalog/UMD_hansen_global_forest_change_2025_v1_13',
    legend: {
      type: 'gradient',
      colors: ['#fee2e2', '#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#b91c1c'],
      minLabel: '2001',
      maxLabel: '2025',
    },
    layerType: 'dynamic-raster',
    apiEndpoint: 'https://us-west1-salish-sea-property-mapper.cloudfunctions.net/hansen-forest-change',
    hideDateRange: true,
    defaultOpacity: 0.7,
    minZoom: 9,
  },
  {
    id: 'opera-dist-alert',
    name: 'Forest Disturbance (DIST-ALERT)',
    description: 'Near-real-time vegetation disturbance alerts from NASA OPERA L3 DIST-ALERT (HLS, 30m). Updated continuously since 2023.',
    category: 'ecological',
    source: '',
    visible: false,
    style: {
      fillColor: '#dc2626',
      fillOpacity: 0,
      strokeColor: '#dc2626',
      strokeWeight: 0,
    },
    popupFields: [],
    standardMessage: 'Near-real-time forest/vegetation disturbance alerts derived from Harmonized Landsat-Sentinel-2 imagery. Choose a view: Recency shows when each disturbance was detected (bright = recent); Status shows whether an alert is provisional or confirmed; Severity shows the magnitude of vegetation loss (0–100%). Complements the Hansen layer above, which is an annual cumulative product. Detects all vegetation cover loss including agriculture, landslides, and tree clearing; not all alerts are deforestation. Verify before drawing conclusions.',
    whyItMatters: {
      text: 'Trees and shrubs do a lot of work. An undisturbed forest can intercept up to 40% of rainfall, protecting against erosion while also slowing surface runoff, increasing infiltration, and protecting water quality. Overhanging vegetation also provides shade, a key factor in keeping beach conditions cool, moist, and organically rich. The insects that live in the trees and shrubs then become food for small fish. Shoreline vegetation is feeding, nesting, roosting, breeding, and migratory habitat for hundreds of wildlife species including eagles, herons, and osprey.',
      source: { credit: 'Living with the Shoreline (Friends of the San Juans)', url: '/reports/living-with-the-shoreline.html' },
    },
    sourceCredit: 'NASA OPERA DIST-ALERT (Harmonized Landsat–Sentinel-2)',
    sourceUrl: 'https://www.earthdata.nasa.gov/data/catalog/lpcloud-opera-l3-dist-alert-hls-v1-1',
    legend: {
      type: 'gradient',
      colors: ['#450a0a', '#7f1d1d', '#b91c1c', '#dc2626', '#ef4444', '#fb923c', '#fbbf24'],
      minLabel: 'older',
      maxLabel: 'recent',
    },
    layerType: 'dynamic-raster',
    apiEndpoint: 'https://us-west1-salish-sea-property-mapper.cloudfunctions.net/opera-dist-alert',
    hideDateRange: true,
    visualizationModes: [
      {
        id: 'recency',
        label: 'Recency',
        legend: {
          type: 'gradient',
          colors: ['#450a0a', '#7f1d1d', '#b91c1c', '#dc2626', '#ef4444', '#fb923c', '#fbbf24'],
          minLabel: 'older',
          maxLabel: 'recent',
        },
      },
      {
        id: 'status',
        label: 'Status',
        legend: {
          type: 'gradient',
          colors: ['#fde68a', '#fb923c', '#fca5a5', '#ef4444', '#b91c1c', '#7f1d1d'],
          minLabel: 'provisional',
          maxLabel: 'confirmed',
        },
      },
      {
        id: 'severity',
        label: 'Severity',
        legend: {
          type: 'gradient',
          colors: ['#fef3c7', '#fde68a', '#fbbf24', '#fb923c', '#ef4444', '#b91c1c'],
          minLabel: '0%',
          maxLabel: '100% loss',
        },
      },
    ],
    defaultOpacity: 0.75,
    minZoom: 9,
  },
  {
    id: 'eelgrass',
    name: 'Eelgrass Beds',
    description: 'Mapped eelgrass (Zostera marina) presence in nearshore areas',
    category: 'ecological',
    source: '/data/eelgrass.geojson',
    visible: true,
    style: {
      fillColor: '#2D6A4F',
      fillOpacity: 0.4,
      strokeColor: '#1B4332',
      strokeWeight: 1,
    },
    popupFields: [
      { key: 'survey_year', label: 'Survey Year' },
      { key: 'density', label: 'Density Class' },
      { key: 'area_sqm', label: 'Area (sq m)' },
    ],
    standardMessage: 'Eelgrass beds are critical nursery habitat for juvenile salmon, forage fish, and Dungeness crab. They also sequester carbon and stabilize shoreline sediments. Development or activity that disturbs eelgrass is regulated under the Shoreline Management Act.',
    whyItMatters: {
      text: 'Eelgrass is a flowering plant that grows in shallow, light-filled marine waters. Eelgrass provides food and shelter for many juvenile fish and shellfish of ecological, cultural, commercial, and recreational importance. The long blades of eelgrass are home to incubating eggs and animals, including crabs and juvenile fish. In addition, eelgrass mitigates wave energy and traps sediments, protecting shorelines from wave driven erosion.',
      source: { credit: 'Living with the Shoreline (Friends of the San Juans)', url: '/reports/living-with-the-shoreline.html' },
    },
    placeholder: true,
  },
  {
    id: 'shoreline-types',
    name: 'Shoreline Types',
    description: 'Classification of shoreline character and substrate',
    category: 'ecological',
    source: '/data/shoreline_types.geojson',
    visible: true,
    style: {
      fillColor: '#0D4F4F',
      fillOpacity: 0,
      strokeColor: '#0D4F4F',
      strokeWeight: 2,
    },
    popupFields: [
      { key: 'shore_type', label: 'Shoreline Type' },
      { key: 'substrate', label: 'Substrate' },
    ],
    standardMessage: 'Shoreline character—whether rocky, sandy, or mixed—determines what species can thrive there. Armoring or modifying natural shorelines disrupts sediment transport and eliminates habitat for forage fish spawning.',
    placeholder: true,
  },
  {
    id: 'habitat-zones',
    name: 'Habitat Zones',
    description: 'Sensitive habitat areas identified through conservation research',
    category: 'ecological',
    source: '/data/habitat_zones.geojson',
    visible: true,
    style: {
      fillColor: '#D4A574',
      fillOpacity: 0.3,
      strokeColor: '#B8865A',
      strokeWeight: 1,
    },
    popupFields: [
      { key: 'habitat_type', label: 'Habitat Type' },
      { key: 'species', label: 'Key Species' },
      { key: 'sensitivity', label: 'Sensitivity' },
    ],
    standardMessage: 'These zones have been identified as ecologically sensitive through surveys and conservation research. Activities in or near these areas may require additional review under local critical areas ordinances.',
    placeholder: true,
  },

  // === Friends of the San Juans Data ===
  // -- Habitat --
  {
    id: 'friends-herring-spawning',
    gpu: true,
    name: 'Forage Fish Spawning: Herring Spawning Grounds',
    description: 'Areas (present or historic) where Pacific Herring spawn (WDFW)',
    category: 'friends-data',
    source: '/data/friends-herring-spawning.json',
    visible: true, // on by default, but only drawn once zoomed in (see minZoom)
    minZoom: 12,
    // A drifting school of small fish is painted over the violet fill from
    // zoom 13 (KelpOverlay, 'school' style).
    renderer: 'herring-school',
    style: {
      zIndex: 1,
      fillColor: '#8B5CF6',
      fillOpacity: 0.3,
      strokeColor: '#6D28D9', // violet — no clash with cream kelp or orange parcels
      strokeWeight: 1.5,
    },
    popupFields: [
      { key: 'Name', label: 'Name' },
      { key: 'OBJECTID', label: 'Object ID' },
    ],
    standardMessage: 'Pacific Herring Spawning — areas (present or historic) where Pacific herring spawn. Herring lay eggs on eelgrass and algae in the nearshore and are a primary food source for salmon, seabirds, and marine mammals.',
    whyItMatters: {
      text: 'Herring, crucial for marine food webs, spawn on eelgrass habitat in just a few locations in San Juan County that are also popular with boaters including Eastsound and West Sound, Blind Bay, Mud Bay, and Hunter Bay. Eelgrass, a vital marine habitat in the Salish Sea, supports Dungeness crabs, Chinook salmon, Pacific herring, and ultimately the Southern Resident killer whales.',
      source: { credit: 'Become a Green Boater Today (sanjuans.org)', url: 'https://sanjuans.org/become-a-green-boater-today/' },
    },
    sourceCredit: 'Washington Department of Fish and Wildlife; compiled by Friends of the San Juans',
  },
  {
    id: 'friends-bull-kelp',
    gpu: true,
    name: 'Bull Kelp',
    description: 'Canopy/floating kelp mapping (DNR and Friends)',
    category: 'friends-data',
    // Merged kelp patches (scripts/build-kelp-patches.py). The raw DNR file is
    // 228,964 one-square-foot raster cells (400 MB) that never rendered visibly.
    source: '/data/friends-bull-kelp-patches.geojson',
    visible: true, // on by default — the client wants nearshore habitat visible while browsing
    // Canopy olive-amber: bull kelp seen from above is a muted golden-brown
    // (blades) with darker umber stipes. Distinct from the eelgrass teal and
    // land greens without being bright. The wide low-zoom halo gives the thin
    // shoreline ribbons enough mass to register at county scale.
    // Rendered by KelpOverlay (chart-style kelp squiggles); this Data-layer
    // style is transparent and only serves as the click target for popups.
    renderer: 'kelp-squiggle',
    // Clickable pins on the larger patches (thinned by zoom like the eelgrass pins),
    // so kelp reads as a feature you can open, not just a texture
    markerIcon: MARKER_ICONS.kelp,
    markerMinAcres: 0.05, // ~2,200 sq ft; skips the sliver patches left over from merging raster cells
    style: {
      fillColor: '#FFF4CC',
      fillOpacity: 0.01,
      strokeColor: '#FFF4CC',
      strokeWeight: 1,
      strokeOpacity: 0,
    },
    popupFields: [
      { key: 'acres', label: 'Acres' },
      { key: 'sqft', label: 'Square feet' },
    ],
    standardMessage: 'Bull Kelp — canopy (floating) kelp mapped by the Washington Department of Natural Resources and Friends of the San Juans. Bull kelp grows on rocky substrate in higher-energy water, absorbs carbon, dampens wave energy, and is vital nursery habitat for coastal marine species. Note: the many understory kelps along rocky shores have not been mapped.',
    whyItMatters: {
      text: 'The San Juans are home to one-third of all floating kelp in the inland waters of Washington State. Kelp helps reduce wave energy that causes beach erosion and provides protected feeding areas for marine mammals, birds, and fish. Kelp shelters urchins, crabs, juvenile rockfish, anemones, starfish, sea cucumbers, octopuses, and many other marine creatures. Shorelines with native vegetation, eelgrass, and kelp help young salmon feed, grow, and avoid predators as they migrate to the open ocean.',
      source: { credit: 'Living with the Shoreline (Friends of the San Juans)', url: '/reports/living-with-the-shoreline.html' },
    },
    sourceCredit: 'Washington Department of Natural Resources and Friends of the San Juans',
  },
  {
    id: 'friends-deepwater-eelgrass',
    gpu: true,
    name: 'Deepwater/Edge Eelgrass',
    description: 'Deepest (waterward) edge of eelgrass meadows (Friends, DNR, Friday Harbor Labs)',
    category: 'friends-data',
    source: '/data/friends-deepwater-eelgrass.geojson',
    visible: true, // on by default — the client wants nearshore habitat visible while browsing
    markerIcon: MARKER_ICONS.eelgrass,
    style: {
      zIndex: 2,
      fillColor: '#20B2AA',
      fillOpacity: 0,
      strokeColor: '#20B2AA',
      strokeWeight: 4.5, // thick enough to click reliably
    },
    popupFields: [
      { key: 'SITE', label: 'Site' },
      { key: 'ISLAND', label: 'Island' },
      { key: 'MEAN', label: 'Mean Depth' },
      { key: 'MAX_', label: 'Max Depth' },
      { key: 'MIN_', label: 'Min Depth' },
      { key: 'SAMP_SIZE', label: 'Sample Size' },
      { key: 'COMMENTS', label: 'Comments' },
    ],
    standardMessage: 'Deep Water Edge of Eelgrass — the deepest (waterward) edge of eelgrass meadows, based on a countywide study by Friends of the San Juans, the Washington Department of Natural Resources, and Friday Harbor Labs. Eelgrass is a flowering marine plant that shelters juvenile salmon and spawning herring, stores carbon, and buffers waves and erosion.',
    whyItMatters: {
      text: 'Eelgrass is a flowering plant that grows in shallow, light-filled marine waters. Eelgrass provides food and shelter for many juvenile fish and shellfish of ecological, cultural, commercial, and recreational importance. The long blades of eelgrass are home to incubating eggs and animals, including crabs and juvenile fish. In addition, eelgrass mitigates wave energy and traps sediments, protecting shorelines from wave driven erosion.',
      source: { credit: 'Living with the Shoreline (Friends of the San Juans)', url: '/reports/living-with-the-shoreline.html' },
    },
    sourceCredit: 'Friends of the San Juans, Washington DNR, and Friday Harbor Labs (countywide eelgrass study)',
  },
  {
    id: 'friends-potential-forage-spawning',
    gpu: true,
    name: 'Forage Fish Beach Spawning: Smelt & Sand Lance — Potential Spawning Habitat',
    description: 'Beach substrate suitable to support spawning by Pacific sand lance or surf smelt',
    category: 'friends-data',
    source: '/data/friends-potential-forage-spawning.json',
    visible: true, // on by default, but only drawn once zoomed in (see minZoom)
    minZoom: 12,
    renderer: 'beach-school-outline',
    haloByZoom: { zoomWide: 15, weightWide: 8, zoomNarrow: 18, weightNarrow: 5 }, // band slims once the beach itself is visible
    style: {
      zIndex: 3,
      fillColor: '#F9A8D4',
      fillOpacity: 0,
      strokeColor: '#F9A8D4', // light pink — same family as documented, lighter = "potential"
      strokeWeight: 8, // soft band; outlined fish (renderer) mark it as potential
      strokeOpacity: 0.3,
    },
    popupFields: [
      { key: 'C_Type_FOSJ', label: 'Shore Type' },
      { key: 'ShoreForm_Unit_ID', label: 'Shoreform Unit' },
    ],
    standardMessage: 'Forage Fish Potential Spawning Habitat — beaches whose substrate is suitable (non-bedrock shores) to support spawning by Pacific sand lance or surf smelt.',
    whyItMatters: {
      text: 'Forage fish are small schooling fish that are eaten by larger fish, seabirds, and marine mammals. Forage fish are staples in the diets of Chinook and Coho salmon, lingcod, Marbled Murrelets, Rhinoceros Auklets, and Minke whales. Forage fish utilize the same shoreline areas that humans do, which makes them vulnerable to modifications such as bulkheads, docks, roads, and the removal of vegetation. A NOAA Fisheries study in northern Puget Sound found that surf smelt egg survival was reduced by 50% in places where the beach habitat was both warmer and drier as a result of the presence of hard armored bulkheads and the absence of trees and shrubs.',
      source: { credit: 'Living with the Shoreline (Friends of the San Juans)', url: '/reports/living-with-the-shoreline.html' },
    },
    sourceCredit: 'Friends of the San Juans',
  },
  {
    id: 'friends-documented-forage-spawning',
    gpu: true,
    name: 'Forage Fish Beach Spawning: Smelt & Sand Lance — Documented Spawning Beaches',
    description: 'Beaches where Pacific sand lance, surf smelt, or both have been found spawning',
    category: 'friends-data',
    source: '/data/friends-documented-forage-spawning.json',
    visible: true, // on by default, but only drawn once zoomed in (see minZoom)
    minZoom: 12,
    // Wide translucent band with a drifting school of solid white fish (KelpOverlay 'beach-solid')
    renderer: 'beach-school',
    haloByZoom: { zoomWide: 15, weightWide: 10, zoomNarrow: 18, weightNarrow: 6 },
    style: {
      zIndex: 4,
      fillColor: '#E11D74',
      fillOpacity: 0,
      strokeColor: '#E11D74', // raspberry — distinct from the orange parcel lines
      strokeWeight: 10, // soft band; the fish school (renderer) sits on it
      strokeOpacity: 0.38,
    },
    popupFields: [
      { key: 'NAME', label: 'Beach Name' },
      { key: 'ISLAND', label: 'Island' },
      { key: 'SPECIES', label: 'Species' },
      { key: 'SMELT_IND', label: 'Smelt' },
      { key: 'SAND_LANCE_IND', label: 'Sand Lance' },
      { key: 'EggCount', label: 'Egg Count' },
      { key: 'RecordsSource', label: 'Source' },
    ],
    standardMessage: 'Documented Forage Fish Beach Spawning Habitat — beaches where Pacific sand lance, surf smelt, or both have been found spawning. Forage fish are a cornerstone of the marine food web, feeding salmon, seabirds, and marine mammals.',
    whyItMatters: {
      text: 'Forage fish are small schooling fish that are eaten by larger fish, seabirds, and marine mammals. Forage fish are staples in the diets of Chinook and Coho salmon, lingcod, Marbled Murrelets, Rhinoceros Auklets, and Minke whales. Forage fish utilize the same shoreline areas that humans do, which makes them vulnerable to modifications such as bulkheads, docks, roads, and the removal of vegetation. A NOAA Fisheries study in northern Puget Sound found that surf smelt egg survival was reduced by 50% in places where the beach habitat was both warmer and drier as a result of the presence of hard armored bulkheads and the absence of trees and shrubs.',
      source: { credit: 'Living with the Shoreline (Friends of the San Juans)', url: '/reports/living-with-the-shoreline.html' },
    },
    sourceCredit: 'Friends of the San Juans forage fish egg surveys, with WDFW records',
  },
  // -- Shoreline --
  {
    id: 'friends-shoreline-geology',
    gpu: true,
    name: 'Shoreline Geology: Shoreforms',
    description: 'Primary geologic features of marine shorelines — coastal processes affect different shore form types in different ways, resulting in different management concerns and priorities',
    category: 'friends-data',
    source: '/data/friends-shoreline-geology.json',
    visible: true, // on by default, drawn from zoom 13 (see minZoom)
    minZoom: 13,
    hitStrokeWeight: 14, // the colored line is 3 px; give it a forgiving click target
    style: {
      zIndex: 5,
      fillColor: '#708090',
      fillOpacity: 0,
      strokeColor: '#708090',
      strokeWeight: 3,
    },
    // Color each segment by its geomorphic shoreform class (see config/shoreforms.ts)
    styleByProperty: {
      property: 'PIAT_shoreforms',
      values: Object.fromEntries(
        Object.entries(SHOREFORM_TYPES).map(([code, t]) => [code, { strokeColor: t.color, strokeWeight: 3 }]),
      ),
      defaultStyle: { strokeColor: '#708090', strokeWeight: 2 },
    },
    legend: {
      type: 'categories',
      items: SHOREFORM_GROUP_ORDER.map(g => ({ label: SHOREFORM_GROUPS[g].label, color: SHOREFORM_GROUPS[g].color })),
    },
    popupFields: [
      { key: 'PIAT_shoreforms', label: 'Shoreform' },
      { key: 'ShoreForm_Unit_ID', label: 'Shoreform Unit' },
      { key: 'FFhab', label: 'Forage Fish Habitat' },
      { key: 'LandUse', label: 'Land Use' },
      { key: 'ShoreDESIG', label: 'Shore Designation' },
      { key: 'PIATprotection', label: 'Protection Priority' },
      { key: 'PIATrestoration', label: 'Restoration Priority' },
      { key: 'SLR_Protect', label: 'SLR Protection' },
      { key: 'SLR_Restore', label: 'SLR Restoration' },
    ],
    standardMessage: 'Geomorphic shoreforms — the primary geologic features of the marine shoreline. Coastal processes affect each shore form differently, so each carries different management concerns and priorities. Definitions below are from Friends of the San Juans\' shoreform mapping.',
    infoItems: SHOREFORM_GROUP_ORDER.map(g => {
      const classes = Object.values(SHOREFORM_TYPES).filter(t => t.group === g);
      return {
        label: SHOREFORM_GROUPS[g].label,
        color: SHOREFORM_GROUPS[g].color,
        text: classes.length === 1 ? classes[0].description : undefined,
        sub: classes.length > 1 ? classes.map(t => ({ label: t.label, text: t.description })) : undefined,
      };
    }),
    whyItMatters: {
      text: 'Feeder bluffs provide the sand that forms and maintains beaches and marine habitats. Experts estimate that over 90% of the sand and gravel that comprise the beaches of Puget Sound and the San Juans comes from eroding banks and bluffs. Within its 400+ miles of shoreline, there are 30 miles of feeder bluffs, 34 miles of transport zones, 25 miles of barrier or accretionary beaches and spits, 48 miles of pocket beaches, 17 miles of embayment estuaries and lagoons, and 250 miles of rocky shores. If your property has a feeder bluff, be sure to set structures far away from the bluff.',
      source: { credit: 'Living with the Shoreline (Friends of the San Juans)', url: '/reports/living-with-the-shoreline.html' },
    },
    sourceCredit: 'Friends of the San Juans geomorphic shoreform mapping',
  },
  {
    id: 'friends-armor',
    gpu: true,
    name: 'Shoreline Armor (2019 survey)',
    description: 'Shoreline armoring — bulkheads, riprap, sea walls, bank stabilization installed to control erosion',
    category: 'friends-data',
    source: '/data/friends-armor.json',
    visible: true, // on by default with the other structures, drawn from zoom 16
    minZoom: 16,
    markerScale: 0.85, // mid-size structures
    markerIcon: MARKER_ICONS.armor, // one pin per segment at its midpoint, thinned by zoom
    style: {
      zIndex: 7,
      fillColor: '#8B0000',
      fillOpacity: 0,
      strokeColor: '#8B0000',
      strokeWeight: 3,
    },
    popupFields: [
      { key: 'Island', label: 'Island' },
      { key: 'ArmorLength', label: 'Armor Length' },
      { key: 'ArmorMaterial', label: 'Material' },
      { key: 'ArmorCondition', label: 'Condition' },
    ],
    standardMessage: 'Shoreline armoring — bulkheads, riprap, sea walls, and bank stabilization mapped in Friends of the San Juans\' 2019 countywide armor survey, with material, condition, toe elevation, and what each structure protects.',
    whyItMatters: {
      text: 'Hard shoreline armoring can reduce short-term wave erosion hazards, but it also starves nearby beaches, impacts fish and wildlife habitat, requires maintenance, and does not address flooding. Bulkheads cause erosion of the beach itself when waves reflect off the hard structure, and they interrupt the processes that maintain beaches over the long term. A NOAA Fisheries study found surf smelt egg survival cut by half where beaches were warmer and drier because of hard armored bulkheads and the absence of trees and shrubs. Hundreds of bulkheads in San Juan County are unnecessary, placed where natural erosion rates are low, and can be removed or redesigned to better protect property and help feed forage fish, salmon, and orca.',
      source: { credit: 'Living with the Shoreline (Friends of the San Juans)', url: '/reports/living-with-the-shoreline.html' },
    },
    sourceCredit: 'Friends of the San Juans shoreline inventory (2009) and armor change survey (2019)',
  },
  // -- Shoreline Infrastructure --
  {
    id: 'friends-groins',
    gpu: true,
    name: 'Groins',
    description: 'Structures perpendicular to shore, intended to trap alongshore sediment transport',
    category: 'friends-data',
    source: '/data/friends-groins.json',
    visible: true, // on by default, drawn from zoom 16 (see minZoom)
    minZoom: 16,
    markerScale: 0.85, // mid-size structures
    markerIcon: MARKER_ICONS.groin,
    style: {
      zIndex: 8,
      fillColor: '#8B4513',
      fillOpacity: 1,
      strokeColor: '#8B4513',
      strokeWeight: 1,
    },
    popupFields: [
      { key: 'Material', label: 'Material' },
      { key: 'Waypoint', label: 'Waypoint' },
      { key: 'CalculatedElevation', label: 'Elevation' },
    ],
    standardMessage: 'Groins — structures that stick out perpendicularly from shore, intended to trap the alongshore transport of sediment. They starve down-drift beaches of material.',
    sourceCredit: 'Friends of the San Juans shoreline inventory',
  },
  {
    id: 'friends-boat-ramps',
    gpu: true,
    name: 'Boat Ramps',
    description: 'Concrete or other structural boat ramps across inter- and subtidal habitats',
    category: 'friends-data',
    source: '/data/friends-boat-ramps.json',
    visible: true, // on by default, drawn from zoom 16 (see minZoom)
    minZoom: 16,
    markerScale: 0.85, // mid-size structures
    markerIcon: MARKER_ICONS.ramp,
    style: {
      fillColor: '#4682B4',
      fillOpacity: 1,
      strokeColor: '#4682B4',
      strokeWeight: 1,
    },
    popupFields: [
      { key: 'Waypoint', label: 'Waypoint' },
      { key: 'SurveyDate', label: 'Survey Date' },
    ],
    standardMessage: 'Improved Boat Ramps — concrete or other structural boat ramps across the inter- and subtidal habitats.',
    sourceCredit: 'Friends of the San Juans shoreline inventory',
  },
  {
    id: 'friends-marine-railway',
    gpu: true,
    name: 'Marine Railways',
    description: 'Typically elevated boat ramp structures',
    category: 'friends-data',
    source: '/data/friends-marine-railway.json',
    visible: true, // on by default, drawn from zoom 16 (see minZoom)
    minZoom: 16,
    markerScale: 0.85, // mid-size structures
    markerIcon: MARKER_ICONS.railway,
    style: {
      fillColor: '#2F4F4F',
      fillOpacity: 1,
      strokeColor: '#2F4F4F',
      strokeWeight: 1,
    },
    popupFields: [
      { key: 'waypoint', label: 'Waypoint' },
      { key: 'Surveytime', label: 'Survey Time' },
    ],
    standardMessage: 'Marine Railways — typically an elevated boat ramp.',
    sourceCredit: 'Friends of the San Juans shoreline inventory',
  },
  {
    id: 'friends-mooring-buoys',
    gpu: true,
    name: 'Mooring Buoys & Floats',
    description: 'In and overwater moorage facilities',
    category: 'friends-data',
    source: '/data/friends-mooring-buoys.json',
    visible: true, // on by default, drawn from zoom 16 (see minZoom)
    minZoom: 16,
    markerScale: 0.65, // small but prolific (1,916): the smallest pin in the hierarchy
    markerIcon: MARKER_ICONS.buoy,
    style: {
      fillColor: '#191970',
      fillOpacity: 1,
      strokeColor: '#191970',
      strokeWeight: 1,
    },
    popupFields: [
      { key: 'Type', label: 'Type' },
      { key: 'OBJECTID', label: 'Object ID' },
    ],
    standardMessage: 'Mooring Buoys & Floats — in- and overwater moorage facilities.',
    whyItMatters: {
      text: 'Around the world and here at home, boat anchors and mooring buoys are known to damage eelgrass when chains drag across the seafloor. Divers inspected 150 buoys and found many located in eelgrass habitat lacked mid-line floats—the simple devices that keep chains from scouring the bottom. With support from the National Fish and Wildlife Foundation, Friends and Frog Marine worked with interested mooring buoy owners to install mid-line floats on 81 moorings, immediately removing this source of damage to eelgrass.',
      source: { credit: 'Restoring Eelgrass to Protect Herring and Salmon (sanjuans.org)', url: 'https://sanjuans.org/restoring-eelgrass-to-protect-herring-and-salmon/' },
    },
    sourceCredit: 'Friends of the San Juans shoreline inventory',
  },
  {
    id: 'friends-pilings',
    gpu: true,
    name: 'Pilings',
    description: 'Pilings not associated with a dock or marina',
    category: 'friends-data',
    source: '/data/friends-pilings.json',
    visible: true, // on by default, drawn from zoom 16 (see minZoom)
    minZoom: 16,
    markerScale: 0.75, // minor structures
    markerIcon: MARKER_ICONS.piling,
    style: {
      fillColor: '#A0522D',
      fillOpacity: 1,
      strokeColor: '#A0522D',
      strokeWeight: 1,
    },
    popupFields: [
      { key: 'Count_', label: 'Count' },
      { key: 'Creosote', label: 'Creosote' },
    ],
    standardMessage: 'Pilings not associated with a dock or marina. Creosote-treated pilings leach toxic compounds into the marine environment.',
    whyItMatters: {
      text: 'While the San Juans do not have large industrial sources of pollution, cars, creosote pilings, failing septic systems, sedimentation, fertilizers, and household chemicals all cause water quality issues. Removal of degraded structures such as derelict docks, boathouses, and creosote pilings can reduce known sources of toxic materials in our waters and recover habitat for fish, shellfish, and people.',
      source: { credit: 'Living with the Shoreline (Friends of the San Juans)', url: '/reports/living-with-the-shoreline.html' },
    },
    sourceCredit: 'Friends of the San Juans shoreline inventory',
  },
  {
    id: 'friends-docks',
    gpu: true,
    name: 'Docks',
    description: 'Smaller overwater structures (does not include marinas)',
    category: 'friends-data',
    source: '/data/friends-docks.geojson',
    visible: true, // on by default, drawn from zoom 16 (see minZoom)
    minZoom: 16,
    markerScale: 0.85, // mid-size structures
    markerIcon: MARKER_ICONS.dock,
    style: {
      fillColor: '#008B8B',
      fillOpacity: 1,
      strokeColor: '#008B8B',
      strokeWeight: 1,
    },
    popupFields: [
      { key: 'TYPE', label: 'Type' },
      { key: 'Material', label: 'Material' },
      { key: 'Condition', label: 'Condition' },
      { key: 'Creosote', label: 'Creosote' },
      { key: 'Grating', label: 'Grating' },
      { key: 'PierHeight', label: 'Pier Height' },
      { key: 'Waypoint', label: 'Waypoint' },
    ],
    standardMessage: 'Docks — smaller overwater structures (this layer does not include marinas). Dock shading and creosote-treated materials can degrade nearshore habitat.',
    whyItMatters: {
      text: 'Juvenile salmon often avoid swimming under docks, and instead move out into deeper waters where they are at risk from predators. Since eelgrass needs light to grow, use a marina or mooring buoy instead of building a new dock which can shade out marine vegetation. If you already have a dock, look into improvements that can increase light penetration such as grating. Removal of degraded structures such as derelict docks, boathouses, and creosote pilings can reduce known sources of toxic materials in our waters and recover habitat for fish, shellfish, and people.',
      source: { credit: 'Living with the Shoreline (Friends of the San Juans)', url: '/reports/living-with-the-shoreline.html' },
    },
    sourceCredit: 'Friends of the San Juans shoreline inventory',
  },
  {
    id: 'friends-projects',
    gpu: true,
    name: "Friends habitat restoration projects",
    description: 'Restoration, riparian, and in/over-water structure projects by Friends of the San Juans',
    category: 'friends-data',
    source: '/data/friends-projects.geojson',
    visible: false, // off on the main map (client, Sept 2026); in the picker under Explore more data
    markerIcon: MARKER_ICONS.friends,
    markerIconByProperty: { property: 'kind', icons: FRIENDS_PROJECT_ICONS },
    markerScale: 1.5, // hero layer: half again the size of every other pin
    legend: {
      type: 'categories',
      items: Object.entries(FRIENDS_PROJECT_COLORS).map(([label, color]) => ({ label, color, shape: 'point' as const })),
    },
    style: {
      strokeColor: '#0D4F4F',
      strokeWeight: 3,
      strokeOpacity: 0.9,
      fillColor: '#0D4F4F',
      fillOpacity: 1,
    },
    popupFields: [
      { key: 'NAME', label: 'Project' },
      { key: 'kind', label: 'Type' },
      { key: 'ISLAND', label: 'Island' },
      { key: 'DATE', label: 'Completed' },
      { key: 'HABITAT_TYPES', label: 'Habitat' },
      { key: 'DESCRIPTION', label: 'Description' },
      { key: 'LINEARFEET_SHORELINE', label: 'Shoreline restored (ft)' },
      { key: 'ACRES_PROTECTED', label: 'Acres protected' },
      { key: 'SQFT_HABITATRESTORED', label: 'Habitat restored (sq ft)' },
      { key: 'ARMOR_LENGTH_FT', label: 'Armor length (ft)' },
      { key: 'ARMOR_MATERIAL', label: 'Armor material' },
      { key: 'ARMOR_WITH', label: 'Armor associated with' },
      { key: 'ARMOR_CONDITION', label: 'Armor condition' },
      { key: 'ARMOR_CONDITION_NOTE', label: 'Condition note' },
      { key: 'AMOUNT', label: 'Structures' },
      { key: 'LINK', label: 'Project page' },
      { key: 'FEATURE_ID', label: 'Feature ID' },
    ],
    standardMessage: "Projects completed by Friends of the San Juans and partners: armor removal, beach and tidal-marsh restoration, culvert replacement, riparian planting, and eelgrass-friendly upgrades to mooring buoys, docks, and pilings. Click a project for its story.",
    sourceCredit: 'Friends of the San Juans restoration program',
  },
  {
    id: 'friends-armor-change-2019',
    gpu: true,
    name: 'Armor Change Analysis (2019)',
    description: 'Shoreline armor change analysis (Friends 2019)',
    category: 'friends-data',
    source: '/data/friends-armor-change-2019.json',
    visible: false,
    style: {
      zIndex: 6,
      strokeColor: '#DC2626',
      strokeWeight: 2.5,
      strokeOpacity: 0.8,
    },
    styleByProperty: {
      property: 'Year_originalArmorMapping',
      values: {
        '2009': { strokeColor: '#F59E0B', strokeWeight: 2.5 },
        '2019': { strokeColor: '#DC2626', strokeWeight: 3 },
      },
    },
    legend: {
      type: 'categories',
      items: [
        { label: 'Mapped in 2009', color: '#F59E0B' },
        { label: 'New armor, 2019', color: '#DC2626' },
      ],
    },
    popupFields: [
      { key: 'Armor_ID', label: 'Armor ID' },
      { key: 'Year_originalArmorMapping', label: 'Year Originally Mapped' },
      { key: 'ConditionArmor', label: 'Condition' },
      { key: 'ArmorContainsRock', label: 'Contains Rock' },
      { key: 'ArmorContainsConcrete', label: 'Contains Concrete' },
      { key: 'ArmorContainsWood', label: 'Contains Wood' },
      { key: 'ArmorContainsCreosotesWood', label: 'Contains Creosote' },
      { key: 'TidalElev_Armor', label: 'Tidal Elevation' },
    ],
    standardMessage: 'Shoreline armor change analysis, 2009 to 2019 — amber segments were mapped in the 2009 shoreline inventory; red segments are armor newly identified in the 2019 survey.',
    whyItMatters: {
      text: 'Hard shoreline armoring can reduce short-term wave erosion hazards, but it also starves nearby beaches, impacts fish and wildlife habitat, requires maintenance, and does not address flooding. Bulkheads cause erosion of the beach itself when waves reflect off the hard structure, and they interrupt the processes that maintain beaches over the long term. A NOAA Fisheries study found surf smelt egg survival cut by half where beaches were warmer and drier because of hard armored bulkheads and the absence of trees and shrubs. Hundreds of bulkheads in San Juan County are unnecessary, placed where natural erosion rates are low, and can be removed or redesigned to better protect property and help feed forage fish, salmon, and orca.',
      source: { credit: 'Living with the Shoreline (Friends of the San Juans)', url: '/reports/living-with-the-shoreline.html' },
    },
    sourceCredit: 'Friends of the San Juans shoreline inventory (2009) and armor change survey (2019)',
  },

  // === Community Science Layers ===
  {
    // Multi-source point observations of marbled murrelet. The runtime
    // category tree slots this under `species` (Species of Interest); the
    // `community-science` category here is a code-side fallback the
    // tree-fetch loader uses if the live tree is unreachable. The sentinel
    // `source: 'observations:multi'` tells useLayers to dispatch to
    // fetchSpeciesObservationsGeoJSON instead of treating the string as a
    // URL. The fetcher pulls GBIF + iNaturalist + eBird in parallel,
    // dedupes GBIF rows whose origin is iNaturalist, and returns Points
    // with a unified property schema (see SpeciesObservationProperties).
    // The popup is rendered by the layer-specific click handler, not the
    // generic popupFields machinery — so popupFields is left empty.
    id: 'marbled-murrelet-observations',
    name: 'Marbled Murrelet Observations',
    description: 'Photographed and checklist observations of marbled murrelet from GBIF, iNaturalist, and eBird — defaults to the last year.',
    category: 'community-science',
    source: 'observations:multi',
    species: {
      gbifKey: 5229281,
      inatTaxonId: 4531,
      ebirdCode: 'marmur',
      scientificName: 'Brachyramphus marmoratus',
      commonName: 'Marbled Murrelet',
      // 200 km covers the full Salish Sea from Olympia to Vancouver to
      // Sooke. iNat alone has ~235 MAMU records in this radius over the
      // past year; the prior 80 km default dropped south Puget Sound.
      defaultRadiusKm: 200,
      defaultDaysBack: 365,
    },
    visible: false,
    style: {
      fillColor: '#FF6A00',
      fillOpacity: 1,
      strokeColor: '#FFFFFF',
      strokeWeight: 1.5,
    },
    popupFields: [],
    standardMessage:
      'Marbled murrelets are listed as Threatened under the federal Endangered Species Act. Markers combine three sources: GBIF (global biodiversity records), iNaturalist (photo-verified citizen science), and eBird (recent checklists, last 30 days only). GBIF rows whose origin is iNaturalist are filtered out to avoid duplicates. Click any marker for the source observation page and photo (when available); drag the slider handles to narrow the date window.',
    whyItMatters: {
      text: 'From marbled murrelets to cormorants, seabirds rely on abundant fish, intact kelp forests, and undisturbed nesting areas.',
      source: { credit: 'Shoreline Ecosystems (sanjuans.org)', url: 'https://sanjuans.org/our-work/shoreline-ecosystems/' },
    },
    sourceCredit: 'GBIF, iNaturalist, and eBird observation records',
    sourceUrl: 'https://www.gbif.org/species/5229281',
  },
  {
    id: 'ebird-hotspots',
    name: 'eBird Hotspots',
    description: 'Birding hotspot locations from eBird (Cornell Lab of Ornithology)',
    category: 'community-science',
    source: 'ebird:hotspots',
    visible: false,
    markerIcon: MARKER_ICONS.bird,
    style: {
      fillColor: '#E63946',
      fillOpacity: 1,
      strokeColor: '#E63946',
      strokeWeight: 1,
    },
    popupFields: [
      { key: 'locName', label: 'Location' },
      { key: 'numSpeciesAllTime', label: 'Species Recorded' },
      { key: 'numChecklistsAllTime', label: 'Checklists' },
      { key: 'latestObsDt', label: 'Latest Observation' },
    ],
    standardMessage: 'eBird hotspots are locations where birders regularly submit checklists. Click a hotspot on the map to view its full eBird report.',
    sourceCredit: 'eBird, Cornell Lab of Ornithology',
  },
];

// Category labels and order are now sourced at runtime from the editable
// category tree at gs://salish-ndvi-tiles/config/category-tree.json.
// See src/services/categoryTree.ts. A baked-in fallback there keeps
// the sidebar working if the live fetch fails.
