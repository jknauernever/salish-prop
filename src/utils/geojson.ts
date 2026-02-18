import type { PopupField } from '../types';

export async function fetchGeoJSON(url: string): Promise<GeoJSON.FeatureCollection | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`Failed to fetch GeoJSON from ${url}: ${response.status}`);
      return null;
    }
    const data = await response.json();
    if (!data || data.type !== 'FeatureCollection') {
      console.warn(`Invalid GeoJSON from ${url}: missing FeatureCollection type`);
      return null;
    }
    return stripZCoordinates(data);
  } catch (err) {
    console.warn(`Error loading GeoJSON from ${url}:`, err);
    return null;
  }
}

function stripZCoordinate(coord: number[]): number[] {
  return coord.length > 2 ? [coord[0], coord[1]] : coord;
}

function stripCoordsRecursive(coords: unknown): unknown {
  if (!Array.isArray(coords)) return coords;
  if (coords.length > 0 && typeof coords[0] === 'number') {
    return stripZCoordinate(coords as number[]);
  }
  return coords.map(stripCoordsRecursive);
}

export function stripZCoordinates(geojson: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  return {
    ...geojson,
    features: geojson.features.map(feature => {
      if (!feature.geometry) return feature;
      const geom = feature.geometry as GeoJSON.Geometry & { coordinates?: unknown };
      if (!('coordinates' in geom)) return feature;
      return {
        ...feature,
        geometry: {
          ...geom,
          coordinates: stripCoordsRecursive(geom.coordinates),
        } as GeoJSON.Geometry,
      };
    }),
  };
}

// Keys to hide — internal/geometry metadata that isn't useful to display
const HIDDEN_KEYS = new Set([
  'Shape_Length', 'Shape_Area', 'OBJECTID', 'RuleID', 'File_Path',
  'image_path', 'img_id', 'Assessor', 'Tax_Info',
]);

function formatValue(key: string, label: string, raw: unknown): string {
  let value = String(raw).trim();
  // Format currency-like values
  const lowerLabel = label.toLowerCase();
  if (lowerLabel.includes('value') || lowerLabel.includes('price')) {
    const num = parseInt(value, 10);
    if (!isNaN(num)) {
      value = '$' + num.toLocaleString();
    }
  }
  // Format dates
  if ((key.toLowerCase().includes('date') || key === 'LastUpdate') && value.includes('T')) {
    value = new Date(value).toLocaleDateString();
  }
  return value;
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase());
}

export function extractAllFeatureProperties(
  feature: GeoJSON.Feature,
  configuredFields: PopupField[]
): { label: string; value: string }[] {
  if (!feature.properties) return [];

  const labelMap = new Map(configuredFields.map(f => [f.key, f.label]));
  const results: { label: string; value: string }[] = [];

  // Show configured fields first (in order), then remaining fields
  const seenKeys = new Set<string>();

  for (const field of configuredFields) {
    const raw = feature.properties[field.key];
    if (raw == null || raw === '' || String(raw).trim() === '') continue;
    results.push({ label: field.label, value: formatValue(field.key, field.label, raw) });
    seenKeys.add(field.key);
  }

  for (const [key, raw] of Object.entries(feature.properties)) {
    if (seenKeys.has(key)) continue;
    if (HIDDEN_KEYS.has(key)) continue;
    if (raw == null || raw === '' || String(raw).trim() === '') continue;
    const label = labelMap.get(key) || humanizeKey(key);
    results.push({ label, value: formatValue(key, label, raw) });
  }

  return results;
}

export function getFeatureLabel(feature: GeoJSON.Feature, layerId: string): string {
  const props = feature.properties;
  if (!props) return 'Unknown Feature';

  switch (layerId) {
    case 'tax-parcels':
      return props.PIN || props.Short_Lega || 'Parcel';
    case 'building-footprints':
      return `Building #${props.FID ?? ''}`;
    case 'stormwater-pipes':
      return props.Pipe_ID || props.ID_Label || 'Pipe';
    default:
      return props.name || props.NAME || props.id || 'Feature';
  }
}
