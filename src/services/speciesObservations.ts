/**
 * Multi-source species observation fetcher.
 *
 * Modeled on the EarthAtlas pattern (/Users/jknauer/Projects/earthatlas/
 * src/services/{gbif,iNaturalist,eBird}.js): pull occurrences from GBIF,
 * iNaturalist, and eBird in parallel, normalize each row to a common
 * shape, dedupe GBIF rows that originally came from iNaturalist, then
 * return a single GeoJSON FeatureCollection ready for a Google Maps Data
 * layer.
 *
 * Public deployment notes:
 *   - No API keys for GBIF (CC BY 4.0 attribution required).
 *   - No API keys for iNaturalist (CC BY-NC 4.0 default).
 *   - eBird requires `VITE_EBIRD_API_KEY`.
 *   - GBIF re-publishes iNaturalist's research-grade observations under
 *     datasetKey `50c9509d-22c7-4a22-a47d-8c48425ef4a7`; we drop those
 *     from the GBIF result to avoid double-counting.
 */

const GBIF_API = 'https://api.gbif.org/v1';
const INAT_API = 'https://api.inaturalist.org/v1';
const EBIRD_API = 'https://api.ebird.org/v2';
const INAT_DATASET_KEY = '50c9509d-22c7-4a22-a47d-8c48425ef4a7';
const EBIRD_API_KEY = import.meta.env.VITE_EBIRD_API_KEY as string | undefined;

export type ObservationSource = 'GBIF' | 'iNaturalist' | 'eBird';

export interface SpeciesObservationProperties {
  id: string; // source-prefixed: 'gbif-...', 'inat-...', 'ebird-...'
  source: ObservationSource;
  comName: string;
  sciName: string;
  obsDate: string; // YYYY-MM-DD
  obsTime: number; // epoch ms — used by the time-range filter
  obsTimeStr: string | null; // HH:MM if available
  place: string | null;
  observer: string | null;
  photoUrl: string | null;
  count: number | null;
  sourceUrl: string;
  [key: string]: unknown; // satisfies GeoJSON.GeoJsonProperties
}

export interface SpeciesIds {
  gbifKey?: number;
  inatTaxonId?: number;
  ebirdCode?: string;
  scientificName?: string;
  commonName?: string;
}

export interface FetchObservationsArgs {
  species: SpeciesIds;
  lat: number;
  lng: number;
  /** Search radius in km. iNat and eBird use this directly; GBIF gets a
   *  square bounding box derived from it (matches the EarthAtlas approach). */
  radiusKm: number;
  /** ISO start/end. End defaults to today. Both inclusive. */
  startDate: string;
  endDate?: string;
  /** Which sources to query. Default: all three. */
  sources?: ObservationSource[];
}

function bbox(lat: number, lng: number, radiusKm: number) {
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

/** eBird's `obsDt` is "YYYY-MM-DD HH:MM" or just "YYYY-MM-DD". Convert to
 *  epoch ms in the user's local TZ — the date string is in the observation's
 *  local timezone with no tz suffix. */
function parseObsTime(dateOnly: string, timeStr: string | null): number {
  if (timeStr) return new Date(`${dateOnly}T${timeStr}`).getTime();
  return new Date(`${dateOnly}T12:00:00`).getTime();
}

function makeFeature(
  lng: number,
  lat: number,
  props: SpeciesObservationProperties,
): GeoJSON.Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: props,
  };
}

// ─── GBIF ────────────────────────────────────────────────────────────────
interface GbifMedia {
  type?: string;
  identifier?: string;
}
interface GbifOcc {
  key: number;
  species?: string;
  scientificName?: string;
  vernacularName?: string;
  decimalLatitude?: number;
  decimalLongitude?: number;
  eventDate?: string;
  media?: GbifMedia[];
  recordedBy?: string;
  institutionCode?: string;
  datasetName?: string;
  datasetKey?: string;
  locality?: string;
  stateProvince?: string;
  country?: string;
  basisOfRecord?: string;
}

async function fetchGBIF(args: FetchObservationsArgs): Promise<GeoJSON.Feature[]> {
  const { gbifKey, scientificName, commonName } = args.species;
  if (!gbifKey) return [];
  const bb = bbox(args.lat, args.lng, args.radiusKm);
  // GBIF caps a single page at 300. Paginate via `offset` up to 1500 rows
  // (matches iNat's pagination ceiling).
  const PAGE = 300;
  const MAX_ROWS = 1500;
  const baseParams: Record<string, string> = {
    hasCoordinate: 'true',
    occurrenceStatus: 'PRESENT',
    taxonKey: String(gbifKey),
    decimalLatitude: `${bb.minLat.toFixed(6)},${bb.maxLat.toFixed(6)}`,
    decimalLongitude: `${bb.minLng.toFixed(6)},${bb.maxLng.toFixed(6)}`,
    eventDate: `${args.startDate},${args.endDate || new Date().toISOString().slice(0, 10)}`,
    limit: String(PAGE),
  };
  const collected: GbifOcc[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const params = new URLSearchParams({ ...baseParams, offset: String(offset) });
    const res = await fetch(`${GBIF_API}/occurrence/search?${params}`);
    if (!res.ok) throw new Error(`GBIF ${res.status} ${res.statusText}`);
    const page = (await res.json()) as {
      results?: GbifOcc[];
      count?: number;
      endOfRecords?: boolean;
    };
    const rows = page.results ?? [];
    collected.push(...rows);
    if (page.endOfRecords || rows.length < PAGE) break;
  }
  const data = { results: collected };
  const out: GeoJSON.Feature[] = [];
  for (const r of data.results ?? []) {
    // Drop iNat-origin records — we hit iNat directly and would otherwise
    // double-count, often with worse metadata (GBIF strips photos sometimes).
    if (r.datasetKey === INAT_DATASET_KEY) continue;
    if (r.decimalLatitude == null || r.decimalLongitude == null) continue;
    const [datePart, timePart] = (r.eventDate ?? '').split('T');
    if (!datePart) continue;
    const timeStr = timePart ? timePart.slice(0, 5) : null;
    const photo =
      (r.media ?? []).find((m) => m.type === 'StillImage' && m.identifier)?.identifier ?? null;
    const place =
      [r.locality, r.stateProvince, r.country].filter(Boolean).join(', ') || null;
    out.push(
      makeFeature(r.decimalLongitude, r.decimalLatitude, {
        id: `gbif-${r.key}`,
        source: 'GBIF',
        comName: r.vernacularName ?? commonName ?? r.species ?? 'Unknown',
        sciName: r.species ?? r.scientificName ?? scientificName ?? '',
        obsDate: datePart,
        obsTime: parseObsTime(datePart, timeStr),
        obsTimeStr: timeStr,
        place,
        observer: r.recordedBy ?? r.institutionCode ?? r.datasetName ?? null,
        photoUrl: photo,
        count: null,
        sourceUrl: `https://www.gbif.org/occurrence/${r.key}`,
      }),
    );
  }
  return out;
}

// ─── iNaturalist ─────────────────────────────────────────────────────────
interface INatPhoto {
  url?: string;
}
interface INatUser {
  login?: string;
}
interface INatObs {
  id: number;
  observed_on?: string;
  observed_on_string?: string;
  time_observed_at?: string;
  taxon?: { name?: string; preferred_common_name?: string };
  geojson?: { coordinates?: [number, number] };
  photos?: INatPhoto[];
  user?: INatUser;
  place_guess?: string;
}

async function fetchINat(args: FetchObservationsArgs): Promise<GeoJSON.Feature[]> {
  const { inatTaxonId, scientificName, commonName } = args.species;
  if (!inatTaxonId) return [];
  const params = new URLSearchParams({
    taxon_id: String(inatTaxonId),
    lat: String(args.lat),
    lng: String(args.lng),
    radius: String(args.radiusKm),
    d1: args.startDate,
    d2: args.endDate || new Date().toISOString().slice(0, 10),
    per_page: '200',
    order: 'desc',
    order_by: 'created_at',
    quality_grade: 'any',
    captive: 'false',
  });
  // iNat hard-caps per_page at 200. For wide-area, full-year queries
  // (the marbled-murrelet layer's default is 200 km × 1 yr → ~235 rows)
  // we paginate up to 5 pages × 200 = 1000 rows. Mirrors the EarthAtlas
  // parallel-fetch pattern but bounded higher because EarthAtlas does
  // viewport-driven refetches and we do not.
  const MAX_PAGES = 5;
  const firstRes = await fetch(`${INAT_API}/observations?${params}`);
  if (!firstRes.ok) throw new Error(`iNat ${firstRes.status} ${firstRes.statusText}`);
  const firstPage = (await firstRes.json()) as { results?: INatObs[]; total_results?: number };
  const total = firstPage.total_results ?? firstPage.results?.length ?? 0;
  const pages = Math.min(MAX_PAGES, Math.ceil(total / 200));
  const allRows: INatObs[] = [...(firstPage.results ?? [])];
  if (pages > 1) {
    const tailFetches: Promise<{ results?: INatObs[] }>[] = [];
    for (let p = 2; p <= pages; p++) {
      const pageParams = new URLSearchParams(params);
      pageParams.set('page', String(p));
      tailFetches.push(
        fetch(`${INAT_API}/observations?${pageParams}`).then((r) =>
          r.ok ? r.json() : { results: [] },
        ),
      );
    }
    const tail = await Promise.all(tailFetches);
    for (const t of tail) {
      if (t.results) allRows.push(...t.results);
    }
  }
  const data = { results: allRows };
  const out: GeoJSON.Feature[] = [];
  for (const o of data.results ?? []) {
    const coords = o.geojson?.coordinates;
    if (!coords || coords.length < 2) continue;
    const dateStr = o.observed_on || o.observed_on_string?.slice(0, 10);
    if (!dateStr) continue;
    let timeStr: string | null = null;
    if (o.time_observed_at) {
      const m = /T(\d{2}:\d{2})/.exec(o.time_observed_at);
      if (m) timeStr = m[1];
    }
    out.push(
      makeFeature(coords[0], coords[1], {
        id: `inat-${o.id}`,
        source: 'iNaturalist',
        comName: o.taxon?.preferred_common_name ?? commonName ?? o.taxon?.name ?? 'Unknown',
        sciName: o.taxon?.name ?? scientificName ?? '',
        obsDate: dateStr,
        obsTime: parseObsTime(dateStr, timeStr),
        obsTimeStr: timeStr,
        place: o.place_guess ?? null,
        observer: o.user?.login ?? null,
        photoUrl: o.photos?.[0]?.url?.replace('/square.', '/medium.') ?? null,
        count: null,
        sourceUrl: `https://www.inaturalist.org/observations/${o.id}`,
      }),
    );
  }
  return out;
}

// ─── eBird ───────────────────────────────────────────────────────────────
interface EbirdObs {
  speciesCode: string;
  comName: string;
  sciName: string;
  locName: string;
  obsDt: string;
  howMany?: number;
  lat: number;
  lng: number;
  subId: string;
}

async function fetchEBird(args: FetchObservationsArgs): Promise<GeoJSON.Feature[]> {
  const { ebirdCode } = args.species;
  if (!ebirdCode || !EBIRD_API_KEY) return [];
  // eBird recent endpoint takes `back` in days (max 30) and clamps `dist`
  // to 50 km. We translate the date range into a days-back lookback,
  // capped at 30. If the user's range starts more than 30 days ago, eBird
  // contributes its last 30 days regardless — note this in the layer's info
  // panel so users understand the asymmetric source coverage.
  const today = new Date();
  const startMs = new Date(`${args.startDate}T12:00:00`).getTime();
  const daysBack = Math.min(
    30,
    Math.max(1, Math.ceil((today.getTime() - startMs) / 86400000)),
  );
  const dist = Math.min(50, args.radiusKm);
  const url =
    `${EBIRD_API}/data/obs/geo/recent/${encodeURIComponent(ebirdCode)}` +
    `?lat=${args.lat}&lng=${args.lng}&dist=${dist}&back=${daysBack}`;
  const res = await fetch(url, { headers: { 'X-eBirdApiToken': EBIRD_API_KEY } });
  if (!res.ok) throw new Error(`eBird ${res.status} ${res.statusText}`);
  const rows = (await res.json()) as EbirdObs[];
  const out: GeoJSON.Feature[] = [];
  for (const o of rows) {
    const [datePart, timePart] = o.obsDt.split(' ');
    out.push(
      makeFeature(o.lng, o.lat, {
        id: `ebird-${o.subId}`,
        source: 'eBird',
        comName: o.comName,
        sciName: o.sciName,
        obsDate: datePart,
        obsTime: parseObsTime(datePart, timePart ?? null),
        obsTimeStr: timePart ?? null,
        place: o.locName ?? null,
        observer: null, // eBird recent obs endpoint doesn't expose observer name
        photoUrl: null, // photos require the Macaulay Library API (separate auth)
        count: o.howMany ?? null,
        sourceUrl: `https://ebird.org/checklist/${o.subId}`,
      }),
    );
  }
  return out;
}

// ─── Public API ──────────────────────────────────────────────────────────
export async function fetchSpeciesObservationsGeoJSON(
  args: FetchObservationsArgs,
): Promise<GeoJSON.FeatureCollection> {
  const sources = args.sources ?? ['GBIF', 'iNaturalist', 'eBird'];
  const tasks: Array<Promise<GeoJSON.Feature[]>> = [];
  if (sources.includes('GBIF')) tasks.push(fetchGBIF(args).catch(() => []));
  if (sources.includes('iNaturalist')) tasks.push(fetchINat(args).catch(() => []));
  if (sources.includes('eBird')) tasks.push(fetchEBird(args).catch(() => []));
  const features = (await Promise.all(tasks)).flat();
  return { type: 'FeatureCollection', features };
}
