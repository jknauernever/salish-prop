import * as turf from '@turf/turf';
import type { LayerState } from '../types';

export interface BuildingProperties {
  address?: string;
  sqFt?: number;
  island?: string;
  pin?: string;
  description?: string;
  source?: string;
}

export interface BuildingQueryResult {
  count: number;
  buildings: BuildingProperties[];
  totalSqFt: number;
}

export interface ShorelineSpeciesResult {
  species: string;
  hrmValue: number;
  lrmValue: number;
}

export interface ShorelineQueryResult {
  species: ShorelineSpeciesResult[];
  shorelineDescription: {
    name: string;
    geoUnit: string;
    systemType: string;
    subType: string;
    materialClass: string;
    featureType: string;
  } | null;
}

const FISH_HABITAT_LAYER_IDS = [
  'chinook-salmon', 'chum-salmon', 'pink-salmon',
  'pacific-herring', 'pacific-sand-lance', 'surf-smelt', 'lingcod-greenling',
];

const SPECIES_CONFIG = [
  { name: 'Chinook Salmon', hrmKey: 'HRM_Ck', lrmKey: 'LRM_Ck' },
  { name: 'Chum Salmon', hrmKey: 'HRM_Chum', lrmKey: 'LRM_Chum' },
  { name: 'Pink Salmon', hrmKey: 'HRM_Pk', lrmKey: 'LRM_Pk' },
  { name: 'Pacific Herring', hrmKey: 'HRM_Herr', lrmKey: 'LRM_Herr' },
  { name: 'Pacific Sand Lance', hrmKey: 'HRM_Lance', lrmKey: 'LRM_Lance' },
  { name: 'Surf Smelt', hrmKey: 'HRM_Smelt', lrmKey: 'LRM_Smelt' },
  { name: 'Lingcod & Greenling', hrmKey: 'HRM_Hex', lrmKey: 'LRM_Hex' },
];

type BBox = GeoJSON.BBox;

function bboxesOverlap(a: BBox, b: BBox): boolean {
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}

export function countIntersectingBuildings(
  parcelFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  buildingLayer: LayerState,
): BuildingQueryResult {
  if (!buildingLayer.geojsonData) return { count: 0, buildings: [], totalSqFt: 0 };

  const parcelBbox = turf.bbox(parcelFeature);
  const buildings: BuildingProperties[] = [];
  let totalSqFt = 0;

  for (const building of buildingLayer.geojsonData.features) {
    if (!building.geometry) continue;
    try {
      const buildingBbox = turf.bbox(building);
      if (!bboxesOverlap(parcelBbox, buildingBbox)) continue;
      if (turf.booleanIntersects(building, parcelFeature)) {
        const p = building.properties || {};
        const sqFt = Number(p.Sq_Ft) || 0;
        totalSqFt += sqFt;
        buildings.push({
          address: String(p.ADDRESS || '').trim() || undefined,
          sqFt: sqFt || undefined,
          island: String(p.Island || '').trim() || undefined,
          pin: String(p.PIN || '').trim() || undefined,
          description: String(p.Discriptio || '').trim() || undefined,
          source: String(p.Source || '').trim() || undefined,
        });
      }
    } catch {
      continue;
    }
  }

  return { count: buildings.length, buildings, totalSqFt };
}

// ---------------------------------------------------------------------------
// Nearshore vegetation query (Bull Kelp + Deepwater Eelgrass within 1000 ft)
// ---------------------------------------------------------------------------

const VEGETATION_BUFFER_FT = 100;
const VEGETATION_BUFFER_KM = VEGETATION_BUFFER_FT * 0.0003048;

export interface NearshoreVegetationResult {
  bullKelp: {
    present: boolean;
    featureCount: number;
    totalAcres: number;
  };
  eelgrass: {
    present: boolean;
    segmentCount: number;
    totalLengthFt: number;
    sites: string[];
    meanDepth: number | null;
    maxDepth: number | null;
  };
}

export function queryNearshoreVegetation(
  parcelFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  layers: LayerState[],
): NearshoreVegetationResult {
  const result: NearshoreVegetationResult = {
    bullKelp: { present: false, featureCount: 0, totalAcres: 0 },
    eelgrass: { present: false, segmentCount: 0, totalLengthFt: 0, sites: [], meanDepth: null, maxDepth: null },
  };

  const buffered = turf.buffer(parcelFeature, VEGETATION_BUFFER_KM, { units: 'kilometers' });
  if (!buffered) return result;
  const searchBbox = turf.bbox(buffered);

  // --- Bull Kelp ---
  const kelpLayer = layers.find(l => l.config.id === 'friends-bull-kelp' && l.loaded && l.geojsonData);
  if (kelpLayer?.geojsonData) {
    let totalAcres = 0;
    let count = 0;
    for (const feat of kelpLayer.geojsonData.features) {
      if (!feat.geometry) continue;
      try {
        const fb = turf.bbox(feat);
        if (!bboxesOverlap(searchBbox, fb)) continue;
        if (turf.booleanIntersects(feat, buffered)) {
          count++;
          totalAcres += Number(feat.properties?.Acres) || 0;
        }
      } catch { continue; }
    }
    result.bullKelp = { present: count > 0, featureCount: count, totalAcres };
  }

  // --- Deepwater/Edge Eelgrass ---
  const eelgrassLayer = layers.find(l => l.config.id === 'friends-deepwater-eelgrass' && l.loaded && l.geojsonData);
  if (eelgrassLayer?.geojsonData) {
    let segmentCount = 0;
    let totalLengthFt = 0;
    const sites = new Set<string>();
    const depths: number[] = [];
    let maxDepth: number | null = null;

    for (const feat of eelgrassLayer.geojsonData.features) {
      if (!feat.geometry) continue;
      try {
        const fb = turf.bbox(feat);
        if (!bboxesOverlap(searchBbox, fb)) continue;
        if (turf.booleanIntersects(feat, buffered)) {
          segmentCount++;
          const p = feat.properties || {};
          totalLengthFt += Number(p.LENGTH) || 0;
          const site = String(p.SITE || '').trim();
          if (site) sites.add(site);
          const mean = Number(p.MEAN);
          if (!isNaN(mean) && mean !== 0) depths.push(mean);
          const mx = Number(p.MAX_);
          if (!isNaN(mx) && mx !== 0) {
            maxDepth = maxDepth === null ? mx : Math.max(maxDepth, mx);
          }
        }
      } catch { continue; }
    }

    const meanDepth = depths.length > 0 ? depths.reduce((a, b) => a + b, 0) / depths.length : null;
    result.eelgrass = {
      present: segmentCount > 0,
      segmentCount,
      totalLengthFt,
      sites: Array.from(sites),
      meanDepth,
      maxDepth,
    };
  }

  return result;
}

// 50 ft buffer in kilometers for shoreline search
const SHORELINE_BUFFER_FT = 50;
const SHORELINE_BUFFER_KM = SHORELINE_BUFFER_FT * 0.0003048;

export function queryShorelineHabitat(
  parcelFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  layers: LayerState[],
): ShorelineQueryResult {
  // Find any loaded fish habitat layer — they all share geometry and properties
  const fishLayer = layers.find(
    l => FISH_HABITAT_LAYER_IDS.includes(l.config.id) && l.loaded && l.geojsonData,
  );

  if (!fishLayer?.geojsonData) {
    return { species: [], shorelineDescription: null };
  }

  // Expand the parcel boundary by 50 ft so we catch nearby shoreline segments
  const buffered = turf.buffer(parcelFeature, SHORELINE_BUFFER_KM, { units: 'kilometers' });
  if (!buffered) {
    return { species: [], shorelineDescription: null };
  }

  const searchBbox = turf.bbox(buffered);
  const intersecting: GeoJSON.Feature[] = [];

  for (const feature of fishLayer.geojsonData.features) {
    if (!feature.geometry) continue;
    try {
      const featureBbox = turf.bbox(feature);
      if (!bboxesOverlap(searchBbox, featureBbox)) continue;
      if (turf.booleanIntersects(feature, buffered)) {
        intersecting.push(feature);
      }
    } catch {
      continue;
    }
  }

  if (intersecting.length === 0) {
    return { species: [], shorelineDescription: null };
  }

  // Aggregate max HRM/LRM per species across all intersecting segments
  const species: ShorelineSpeciesResult[] = [];
  for (const sp of SPECIES_CONFIG) {
    let maxHrm = 0;
    let maxLrm = 0;
    for (const feat of intersecting) {
      const hrm = Number(feat.properties?.[sp.hrmKey]) || 0;
      const lrm = Number(feat.properties?.[sp.lrmKey]) || 0;
      maxHrm = Math.max(maxHrm, hrm);
      maxLrm = Math.max(maxLrm, lrm);
    }
    if (maxHrm > 0 || maxLrm > 0) {
      species.push({ species: sp.name, hrmValue: maxHrm, lrmValue: maxLrm });
    }
  }

  species.sort((a, b) => b.hrmValue - a.hrmValue);

  // Shoreline description from the first intersecting feature
  const props = intersecting[0].properties || {};
  const shorelineDescription = {
    name: String(props.Name || ''),
    geoUnit: String(props.GeoUnit || ''),
    systemType: String(props.RITT_SysTy || ''),
    subType: String(props.RITT_SubTy || ''),
    materialClass: String(props.MatrlClass || ''),
    featureType: String(props.FType || ''),
  };

  return { species, shorelineDescription };
}
