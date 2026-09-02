import * as turf from '@turf/turf';
import type { LayerState } from '../types';
import type { NearshoreParcelRecord, NearshoreStatsMeta } from './nearshoreStats';

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
// Nearshore habitat (kelp, eelgrass, forage fish, herring) — from the
// precomputed per-parcel stats file (see services/nearshoreStats.ts).
// ---------------------------------------------------------------------------

export interface NearshoreVegetationResult {
  /** Search distances the numbers were computed with (feet). */
  distances: { kelpFt: number; eelgrassFt: number; forageFt: number; herringFt: number };
  bullKelp: {
    present: boolean;
    featureCount: number;
    totalAcres: number;
    distFt: number | null;
  };
  eelgrass: {
    present: boolean;
    segmentCount: number;
    totalLengthFt: number;
    sites: string[];
    meanDepth: number | null;
    maxDepth: number | null;
    distFt: number | null;
  };
  forage: {
    present: boolean;
    documented: { name: string; species: string; smelt: boolean; sandLance: boolean; distFt: number }[];
    potentialCount: number;
  };
  herring: {
    present: boolean;
    names: string[];
  };
  /** Nearest Friends geomorphic shoreform segment, if one lies within meta.shoreformFt. */
  shoreform: NearshoreParcelRecord['shoreform'] | null;
}

export function nearshoreFromStats(
  rec: NearshoreParcelRecord | undefined,
  meta: NearshoreStatsMeta,
): NearshoreVegetationResult {
  const k = rec?.kelp;
  const e = rec?.eelgrass;
  const f = rec?.forage;
  const h = rec?.herring ?? [];
  return {
    distances: { kelpFt: meta.kelpFt, eelgrassFt: meta.eelgrassFt, forageFt: meta.forageFt, herringFt: meta.herringFt ?? 100 },
    bullKelp: {
      present: !!k && k.n > 0,
      featureCount: k?.n ?? 0,
      totalAcres: k?.acres ?? 0,
      distFt: k?.distFt ?? null,
    },
    eelgrass: {
      present: !!e && e.n > 0,
      segmentCount: e?.n ?? 0,
      totalLengthFt: e?.lengthFt ?? 0,
      sites: e?.sites ?? [],
      meanDepth: e?.meanDepth ?? null,
      maxDepth: e?.maxDepth ?? null,
      distFt: e?.distFt ?? null,
    },
    forage: {
      present: !!f && (f.documented.length > 0 || f.potentialN > 0),
      documented: f?.documented ?? [],
      potentialCount: f?.potentialN ?? 0,
    },
    herring: { present: h.length > 0, names: h },
    shoreform: rec?.shoreform ?? null,
  };
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
