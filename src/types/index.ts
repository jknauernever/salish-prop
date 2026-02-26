export type LayerCategory = 'ecological' | 'fish-habitat' | 'property' | 'community-science' | 'planning' | 'friends-data';

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
  defaultOpacity?: number;
  viewportFiltered?: boolean;
  markerIcon?: string;
  styleByProperty?: StyleByProperty;
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
