/**
 * Per-parcel proximity to Friends of the San Juans nearshore datasets,
 * precomputed by scripts/compute-nearshore-stats.py into
 * public/data/nearshore_parcel_stats.json (keyed by parcel FID, like the
 * NDVI stats).
 *
 * The property popup reads this instead of running live turf.js queries, so
 * kelp / eelgrass / forage fish / herring always appear in a property report
 * regardless of which layers are switched on — and the search distances are
 * the agreed ones (500 ft offshore features, 100 ft beaches and herring grounds)
 * rather than the old 100 ft that missed offshore beds.
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
}

export interface NearshoreStatsMeta {
  generated: string;
  kelpFt: number;
  eelgrassFt: number;
  forageFt: number;
  herringFt: number;
  shoreformFt?: number;
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
  forageFt: 100,
  herringFt: 100,
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
