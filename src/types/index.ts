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
  legend?: GradientLegend;
  defaultOpacity?: number;
  viewportFiltered?: boolean;
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
