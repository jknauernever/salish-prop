/**
 * Per-parcel proximity to Friends of the San Juans nearshore datasets,
 * precomputed by scripts/compute-nearshore-stats.py into
 * public/data/nearshore_parcel_stats.json (keyed by parcel FID, like the
 * NDVI stats).
 *
 * The property popup reads this instead of running live turf.js queries, so
 * kelp / eelgrass / forage fish / herring always appear in a property report
 * regardless of which layers are switched on — and the search distances are
 * the agreed ones (500 ft offshore features, 200 ft beaches and shoreforms, 100 ft
 * herring grounds; armor 50 ft, structures 100 ft, buoys 300 ft).
 */

export interface NearshoreParcelRecord {
  kelp?: { n: number; acres: number; distFt: number };
  eelgrass?: {
    n: number;
    lengthFt: number;
    meanDepth: number | null;
    maxDepth: number | null;
    distFt: number;
    sites: string[];
  };
  forage?: {
    documented: { name: string; species: string; smelt: boolean; sandLance: boolean; distFt: number }[];
    potentialN: number;
  };
  herring?: string[];
  shoreform?: {
    code: string;
    unitId: string;
    distFt: number;
    ffhab: string;
    landUse: string;
    shoreDesig: string;
    protection: string;
    restoration: string;
    publicOwnership: boolean;
  };
  /** Beamer & Fresh fish-use scores for shoreline segments within meta.fishFt. */
  fish?: {
    distFt: number;
    /** Keyed by species code (Ck, Chum, Pk, Herr, Lance, Smelt, Hex); values 0–1. */
    scores: Record<string, { hrm: number; lrm: number }>;
    segment: { name: string; geoUnit: string; systemType: string; subType: string; materialClass: string; featureType: string };
  };
  /** Nearest surveyed shoreline at any distance (every parcel has one). */
  shore?: { distFt: number; name: string };
  /** Shoreline modifications from Friends' field surveys, within the meta distances. */
  mods?: {
    armor?: { n: number; lengthFt: number; distFt: number };
    docks?: { distFt: number; material: string; floatMaterial: string; creosote: boolean; grating: boolean; condition: string }[];
    groins?: { n: number; distFt: number };
    ramps?: { n: number; distFt: number };
    railways?: { n: number; distFt: number };
    pilings?: { n: number; count: number; creosote: boolean; distFt: number };
    buoys?: { n: number; distFt: number; types: Record<string, number> };
  };
}

export interface NearshoreStatsMeta {
  generated: string;
  kelpFt: number;
  eelgrassFt: number;
  forageFt: number;
  herringFt: number;
  shoreformFt?: number;
  fishFt?: number;
  armorFt?: number;
  structureFt?: number;
  buoyFt?: number;
  parcels: number;
  parcelsWithHits: number;
}

export interface NearshoreStatsFile {
  meta: NearshoreStatsMeta;
  parcels: Record<string, NearshoreParcelRecord>;
}

/** Used for copy when the stats file is unavailable. Keep in sync with the script. */
export const DEFAULT_NEARSHORE_META: NearshoreStatsMeta = {
  generated: '',
  kelpFt: 500,
  eelgrassFt: 500,
  forageFt: 200,
  herringFt: 100,
  shoreformFt: 200,
  fishFt: 200,
  armorFt: 50,
  structureFt: 100,
  buoyFt: 300,
  parcels: 0,
  parcelsWithHits: 0,
};

let inflight: Promise<NearshoreStatsFile | null> | null = null;

export function getNearshoreStats(): Promise<NearshoreStatsFile | null> {
  if (inflight) return inflight;
  inflight = fetch('/data/nearshore_parcel_stats.json')
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as NearshoreStatsFile;
      if (!data || typeof data !== 'object' || !data.parcels) throw new Error('bad shape');
      return data;
    })
    .catch((err) => {
      console.warn('Nearshore stats unavailable:', err);
      return null;
    });
  return inflight;
}
