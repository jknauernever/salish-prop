import * as turf from '@turf/turf';
import type { SpatialQueryParams, SpatialQueryResult, LayerState } from '../types';

export interface SpatialQueryOutput {
  results: SpatialQueryResult[];
  homeParcel: GeoJSON.Feature | null;
}

export function queryRadius(params: SpatialQueryParams): SpatialQueryOutput {
  const { center, radiusMeters, layers } = params;
  const [lng, lat] = center;

  const point = turf.point([lng, lat]);
  const buffer = turf.buffer(point, radiusMeters / 1000, { units: 'kilometers' });
  if (!buffer) return { results: [], homeParcel: null };

  const bufferBbox = turf.bbox(buffer);
  const results: SpatialQueryResult[] = [];
  let homeParcel: GeoJSON.Feature | null = null;

  for (const layer of layers) {
    if (!layer.geojsonData || !layer.loaded) continue;

    const intersecting = findIntersectingFeatures(layer, buffer, bufferBbox);

    // Find the parcel that contains the searched point
    if (layer.config.id === 'tax-parcels') {
      homeParcel = findContainingParcel(layer, point);
    }

    if (intersecting.length > 0) {
      results.push({
        layerId: layer.config.id,
        layerName: layer.config.name,
        features: intersecting,
        count: intersecting.length,
        style: layer.config.style,
      });
    }
  }

  return { results, homeParcel };
}

function findContainingParcel(
  layer: LayerState,
  point: GeoJSON.Feature<GeoJSON.Point>
): GeoJSON.Feature | null {
  const features = layer.geojsonData?.features;
  if (!features) return null;

  for (const feature of features) {
    if (!feature.geometry || feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') continue;
    try {
      if (turf.booleanPointInPolygon(point, feature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>)) {
        return feature;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function findIntersectingFeatures(
  layer: LayerState,
  buffer: GeoJSON.Feature<GeoJSON.Polygon>,
  bufferBbox: turf.BBox
): GeoJSON.Feature[] {
  const features = layer.geojsonData?.features;
  if (!features) return [];

  const results: GeoJSON.Feature[] = [];

  for (const feature of features) {
    if (!feature.geometry) continue;

    try {
      // Bbox pre-filter for performance
      const featureBbox = turf.bbox(feature);
      if (!bboxesOverlap(bufferBbox, featureBbox)) continue;

      if (turf.booleanIntersects(feature, buffer)) {
        results.push(feature);
      }
    } catch {
      // Skip features that cause geometry errors
      continue;
    }
  }

  return results;
}

function bboxesOverlap(a: turf.BBox, b: turf.BBox): boolean {
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}
