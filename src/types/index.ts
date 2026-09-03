// Category ids are now validated at runtime against the fetched tree
// (see src/services/categoryTree.ts → validateLayerCategories) instead of
// the type system. The union was dropped when categories became editable.
export type LayerCategory = string;

export interface PopupField {
  key: string;
  label: string;
}

export interface LayerStyle {
  fillColor?: string;
  fillOpacity?: number;
  strokeColor: string;
  strokeWeight: number;
  strokeOpacity?: number;
}

export interface StyleByProperty {
  property: string;
  values: Record<string, Partial<LayerStyle>>;
  defaultStyle?: Partial<LayerStyle>;
}

/** Color-ramp legend for raster layers (e.g. NDVI, Hansen loss-by-year). */
export interface GradientLegend {
  type: 'gradient';
  colors: string[];
  minLabel: string;
  maxLabel: string;
}

/** Swatch list legend for vector layers styled by category (e.g. armor change year). */
export interface CategoryLegend {
  type: 'categories';
  items: { label: string; color: string; shape?: 'line' | 'fill' | 'point' }[];
}

export type LayerLegend = GradientLegend | CategoryLegend;

export interface LayerConfig {
  id: string;
  name: string;
  description: string;
  category: LayerCategory;
  source: string;
  visible: boolean;
  style: LayerStyle;
  popupFields: PopupField[];
  standardMessage?: string;
  minZoom?: number;
  placeholder?: boolean;
  layerType?: 'vector' | 'raster' | 'dynamic-raster';
  tileUrl?: string;
  apiEndpoint?: string;
  /** For dynamic-raster layers that don't need a date picker (e.g. cumulative datasets). */
  hideDateRange?: boolean;
  /**
   * Visualization modes for dynamic-raster layers that render the same dataset
   * multiple ways. Renders as a segmented toggle under the layer row; the
   * selected mode's `id` is passed to `apiEndpoint` as `?mode=...`. First entry
   * is the default. Per-mode `legend` overrides the row's top-level legend
   * while that mode is selected.
   */
  visualizationModes?: {
    id: string;
    label: string;
    legend?: GradientLegend;
  }[];
  /** Link to the canonical data source. Surfaces as a "Learn more" link in the info panel. */
  sourceUrl?: string;
  /** Visual legend rendered under the row when the layer is visible. */
  legend?: LayerLegend;
  /**
   * Who produced the data (shown as "Source: …" in the layer's info panel).
   * Keep it short — organisation names and a year, not a paragraph.
   */
  sourceCredit?: string;
  defaultOpacity?: number;
  /**
   * Zoom-scaled "halo" stroke for thin polygon layers (e.g. kelp ribbons):
   * a wide, semi-transparent stroke at low zoom that narrows as you zoom in,
   * so shoreline-hugging slivers still read as a mass from county scale.
   * Weight is interpolated linearly between the two zoom stops.
   */
  haloByZoom?: {
    zoomWide: number;
    weightWide: number;
    zoomNarrow: number;
    weightNarrow: number;
    /** Stroke color/opacity while the halo is wide (below the midpoint zoom); the base style's stroke is used when narrow. */
    strokeColorWide?: string;
    strokeOpacityWide?: number;
  };
  viewportFiltered?: boolean;
  /**
   * Vector tiles (deck.gl MVTLayer) instead of a GeoJSON download. `url` is a
   * {z}/{x}/{y}.pbf template; `sourceLayer` is the tippecanoe layer name.
   * When set, `source` is not fetched.
   */
  tiles?: { url: string; sourceLayer: string; minZoom: number; maxZoom: number; idProperty?: string };
  /** Pick the marker icon per feature from a property value; falls back to `markerIcon`. */
  markerIconByProperty?: { property: string; icons: Record<string, string> };
  /** Multiplier on the standard 24×26 px marker size (e.g. 2 for a hero layer). */
  markerScale?: number;
  /**
   * Draw this polygon layer with a custom canvas overlay instead of Data-layer
   * styling. 'kelp-squiggle' = nautical-chart kelp symbol pattern fill (see
   * components/Map/KelpOverlay.ts). The Data layer stays as an invisible
   * click target so popups still work.
   */
  renderer?: 'kelp-squiggle';
  markerIcon?: string;
  styleByProperty?: StyleByProperty;
  /**
   * Multi-source species lookup IDs for `source: 'observations:multi'`
   * layers. Each provider has its own ID scheme; we keep all three so the
   * fetcher can hit GBIF + iNaturalist + eBird in parallel (matches the
   * EarthAtlas pattern). `scientificName` / `commonName` are fallbacks
   * shown in the popup when a source row is missing them.
   */
  species?: {
    gbifKey?: number;
    inatTaxonId?: number;
    ebirdCode?: string;
    scientificName: string;
    commonName: string;
    /** Default search radius in km. */
    defaultRadiusKm?: number;
    /** Default lookback in days. The slider only narrows within this window. */
    defaultDaysBack?: number;
  };
}

/**
 * Inclusive ISO date range (YYYY-MM-DD). Either bound may be `null`,
 * meaning "no constraint on that end" — matches the EarthAtlas slider
 * convention where dragging a handle to the edge clears the bound.
 */
export interface DateRange {
  start: string | null;
  end: string | null;
}

export interface LayerState {
  config: LayerConfig;
  visible: boolean;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  featureCount: number;
  geojsonData: GeoJSON.FeatureCollection | null;
  dataLayer: google.maps.Data | null;
  opacity?: number;
  /**
   * Active date filter for multi-source observation layers. Features whose
   * `obsTime` property falls outside [start, end] are hidden via the Data
   * layer's style function. `null` bounds mean "no constraint".
   */
  dateRange?: DateRange;
  /** Selected visualization mode id for dynamic-raster layers with `visualizationModes`. */
  vizMode?: string;
  /** Selected Sentinel-2 season slug (e.g. "summer-2024") for the seasonal NDVI layer. */
  season?: string;
}

export interface SpatialQueryResult {
  layerId: string;
  layerName: string;
  features: GeoJSON.Feature[];
  count: number;
  style: LayerStyle;
}

export interface SpatialQueryParams {
  center: [number, number]; // [lng, lat]
  radiusMeters: number;
  layers: LayerState[];
}

export interface SpatialQueryService {
  queryRadius(params: SpatialQueryParams): SpatialQueryResult[];
}

export interface GeocodingResult {
  lat: number;
  lng: number;
  formattedAddress: string;
}

export interface SearchState {
  location: GeocodingResult | null;
  radiusMeters: number;
  isSearching: boolean;
}
