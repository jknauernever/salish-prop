const EBIRD_BASE = 'https://api.ebird.org/v2';
const API_KEY = import.meta.env.VITE_EBIRD_API_KEY as string;

interface EBirdObservation {
  speciesCode: string;
  comName: string;
  sciName: string;
  locId: string;
  locName: string;
  obsDt: string;
  howMany?: number;
  lat: number;
  lng: number;
  obsValid: boolean;
  obsReviewed: boolean;
  locationPrivate: boolean;
  subId: string;
}

export interface BirdSpeciesSummary {
  speciesCode: string;
  comName: string;
  sciName: string;
  count: number;
}

/**
 * Fetch recent nearby observations from eBird and aggregate into per-species counts.
 * @param lat  Latitude of the center point
 * @param lng  Longitude of the center point
 * @param back Number of days back (1–30)
 * @param dist Radius in km (max 50, default 10)
 */
export async function fetchNearbyBirdSummary(
  lat: number,
  lng: number,
  back: number = 30,
  dist: number = 10,
): Promise<BirdSpeciesSummary[]> {
  const url = `${EBIRD_BASE}/data/obs/geo/recent?lat=${lat}&lng=${lng}&dist=${dist}&back=${back}`;
  const res = await fetch(url, {
    headers: { 'X-eBirdApiToken': API_KEY },
  });

  if (!res.ok) {
    throw new Error(`eBird API error: ${res.status} ${res.statusText}`);
  }

  const observations: EBirdObservation[] = await res.json();

  // Aggregate by species — sum howMany (default 1 if not reported)
  const speciesMap = new Map<string, BirdSpeciesSummary>();
  for (const obs of observations) {
    const existing = speciesMap.get(obs.speciesCode);
    const qty = obs.howMany ?? 1;
    if (existing) {
      existing.count += qty;
    } else {
      speciesMap.set(obs.speciesCode, {
        speciesCode: obs.speciesCode,
        comName: obs.comName,
        sciName: obs.sciName,
        count: qty,
      });
    }
  }

  // Sort by count descending, then alphabetically by common name
  return Array.from(speciesMap.values()).sort(
    (a, b) => b.count - a.count || a.comName.localeCompare(b.comName),
  );
}

interface EBirdHotspot {
  locId: string;
  locName: string;
  countryCode: string;
  subnational1Code: string;
  subnational2Code: string;
  lat: number;
  lng: number;
  latestObsDt?: string;
  numSpeciesAllTime?: number;
  numChecklistsAllTime?: number;
}

/**
 * Fetch nearby eBird hotspots and return as a GeoJSON FeatureCollection.
 * Each feature is a Point with properties including locId, locName, species count, etc.
 */
export async function fetchHotspotsGeoJSON(
  lat: number,
  lng: number,
  dist: number = 30,
): Promise<GeoJSON.FeatureCollection> {
  const url = `${EBIRD_BASE}/ref/hotspot/geo?lat=${lat}&lng=${lng}&dist=${dist}&fmt=json`;
  const res = await fetch(url, {
    headers: { 'X-eBirdApiToken': API_KEY },
  });

  if (!res.ok) {
    throw new Error(`eBird API error: ${res.status} ${res.statusText}`);
  }

  const hotspots: EBirdHotspot[] = await res.json();

  const features: GeoJSON.Feature[] = hotspots.map(h => ({
    type: 'Feature' as const,
    geometry: {
      type: 'Point' as const,
      coordinates: [h.lng, h.lat],
    },
    properties: {
      locId: h.locId,
      locName: h.locName,
      numSpeciesAllTime: h.numSpeciesAllTime ?? 0,
      numChecklistsAllTime: h.numChecklistsAllTime ?? 0,
      latestObsDt: h.latestObsDt ?? '',
      ebirdUrl: `https://ebird.org/hotspot/${h.locId}`,
    },
  }));

  return { type: 'FeatureCollection', features };
}
