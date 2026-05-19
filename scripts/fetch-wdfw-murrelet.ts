/**
 * Downloads marbled-murrelet at-sea density data from WDFW's wildlife-survey
 * ArcGIS REST services. Run with `npx tsx scripts/fetch-wdfw-murrelet.ts`.
 *
 * Caveats to remember when consuming these outputs:
 *   1. Density estimates are stratum-level, not point-level. The 30m raster
 *      products in the *_MosaicDataset ImageServers (see the catalog files)
 *      are interpolated display surfaces, not raw observation density.
 *   2. Coverage is US Salish Sea only; no BC waters.
 *   3. Service metadata carries no explicit open-data license, only
 *      "WDFW - Wildlife Program" copyright. We need separate attribution +
 *      permission (Scott Pearson group) before public deployment.
 *
 * Stats schemas differ between the two services and we preserve each
 * verbatim rather than coercing to a common shape:
 *   - MRB Stats: EstBirds / Lower / Upper / Density / Density_SE / Density_CV
 *     (boat surveys, point-count style with normal-CL intervals).
 *   - PSEMP Stats: Median / Lower_90 / Upper_90 + *_Density variants
 *     (winter aerial surveys, distance-sampling bootstrap intervals).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'public', 'data');

const UA = 'salish-sea-propmapper/1.0 (josh@knauernever.com)';
const BASE = 'https://geodataservices.wdfw.wa.gov/arcgis/rest/services/WP_WildlifeSurveys';

const SPECIES_CODE = 'MAMU'; // confirmed via /MRB/MapServer/2 + /PSEMP/MapServer/1 probes

interface ArcRestEnvelope<T> {
  features?: T[];
  count?: number;
  error?: { code: number; message: string; details?: string[] };
  exceededTransferLimit?: boolean;
}

async function arcGet<T = unknown>(
  url: string,
  params: Record<string, string>,
): Promise<ArcRestEnvelope<T>> {
  const qs = new URLSearchParams({ f: 'json', ...params });
  const res = await fetch(`${url}?${qs.toString()}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  const body = (await res.json()) as ArcRestEnvelope<T>;
  if (body.error) {
    throw new Error(`ArcGIS error ${body.error.code}: ${body.error.message}`);
  }
  return body;
}

async function arcGetGeoJSON(
  url: string,
  params: Record<string, string>,
): Promise<GeoJSON.FeatureCollection> {
  const qs = new URLSearchParams({ f: 'geojson', ...params });
  const res = await fetch(`${url}?${qs.toString()}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return (await res.json()) as GeoJSON.FeatureCollection;
}

/** Sleep between requests so we are a polite client. */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface StrataFetchResult {
  fc: GeoJSON.FeatureCollection;
  byStrataId: Map<string, GeoJSON.Feature>;
}

async function fetchStrata(
  mapServerUrl: string,
  outFields: string[],
): Promise<StrataFetchResult> {
  // outSR=4326 asks the server to reproject (MRB native is EPSG:26910);
  // confirmed `supportsDatumTransformation: true` on both services.
  const fc = await arcGetGeoJSON(`${mapServerUrl}/0/query`, {
    where: '1=1',
    outFields: outFields.join(','),
    returnGeometry: 'true',
    outSR: '4326',
  });
  const byStrataId = new Map<string, GeoJSON.Feature>();
  for (const f of fc.features) {
    const sid = String(f.properties?.StrataID ?? '');
    if (sid) byStrataId.set(sid, f);
  }
  return { fc, byStrataId };
}

interface AttrRow {
  attributes: Record<string, unknown>;
}

/**
 * Paginate stats rows by OBJECTID. Both Stats tables can in principle exceed
 * 2000 rows for a single species across all years; we paginate just in case
 * (current counts: MRB MAMU=72, PSEMP MAMU=936). resultRecordCount=1000 to
 * stay well under the typical maxRecordCount limit.
 */
async function fetchAllStats(
  mapServerUrl: string,
  tableId: number,
  outFields: string[],
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let lastOID = -1;
  const pageSize = 1000;
  for (let safety = 0; safety < 200; safety++) {
    const where = `SpeciesCode='${SPECIES_CODE}' AND OBJECTID>${lastOID}`;
    const body = await arcGet<AttrRow>(`${mapServerUrl}/${tableId}/query`, {
      where,
      outFields: outFields.join(','),
      orderByFields: 'OBJECTID ASC',
      returnGeometry: 'false',
      resultRecordCount: String(pageSize),
    });
    const features = body.features ?? [];
    if (features.length === 0) break;
    for (const f of features) all.push(f.attributes);
    const last = features[features.length - 1].attributes['OBJECTID'];
    if (typeof last !== 'number') {
      throw new Error('Stats row missing numeric OBJECTID — cannot paginate');
    }
    lastOID = last;
    if (!body.exceededTransferLimit && features.length < pageSize) break;
    await sleep(250);
  }
  return all;
}

interface MosaicCatalogEntry {
  OBJECTID: number;
  Name?: string;
  Tag?: string;
  GroupName?: string;
  ProductName?: string;
  Year?: number;
  SpeciesCode?: string;
}

/**
 * The ImageServer's catalog has one row per source raster. We pull a generous
 * set of attributes for the murrelet rows so Josh can later decide which to
 * surface (Name carries year/species/program info on these services).
 */
async function fetchMosaicCatalog(
  imageServerUrl: string,
): Promise<MosaicCatalogEntry[]> {
  const out: MosaicCatalogEntry[] = [];
  let lastOID = -1;
  const pageSize = 1000;
  // Many of these ImageServer catalogs do not expose Tag/GroupName as filterable
  // fields. We grep the full catalog client-side on Name to avoid a 400.
  for (let safety = 0; safety < 200; safety++) {
    const body = await arcGet<AttrRow>(`${imageServerUrl}/query`, {
      where: `OBJECTID>${lastOID}`,
      outFields: 'OBJECTID,Name',
      orderByFields: 'OBJECTID ASC',
      returnGeometry: 'false',
      resultRecordCount: String(pageSize),
    });
    const features = body.features ?? [];
    if (features.length === 0) break;
    for (const f of features) {
      const name = String(f.attributes['Name'] ?? '');
      if (/MAMU|murrelet/i.test(name)) {
        out.push({
          OBJECTID: f.attributes['OBJECTID'] as number,
          Name: name,
        });
      }
    }
    const last = features[features.length - 1].attributes['OBJECTID'];
    if (typeof last !== 'number') break;
    lastOID = last;
    if (!body.exceededTransferLimit && features.length < pageSize) break;
    await sleep(250);
  }
  // Pull a richer attribute set for the matched rows now that we have OBJECTIDs.
  if (out.length === 0) return out;
  const ids = out.map((e) => e.OBJECTID).join(',');
  const body = await arcGet<AttrRow>(`${imageServerUrl}/query`, {
    where: `OBJECTID IN (${ids})`,
    outFields: '*',
    returnGeometry: 'false',
    resultRecordCount: String(Math.max(pageSize, out.length)),
  });
  const enriched = new Map<number, Record<string, unknown>>();
  for (const f of body.features ?? []) {
    enriched.set(f.attributes['OBJECTID'] as number, f.attributes);
  }
  return out.map((e) => {
    const attrs = enriched.get(e.OBJECTID) ?? {};
    const yearMatch = /(\d{4})/.exec(e.Name ?? '');
    return {
      OBJECTID: e.OBJECTID,
      Name: e.Name,
      Tag: attrs['Tag'] as string | undefined,
      GroupName: attrs['GroupName'] as string | undefined,
      ProductName: attrs['ProductName'] as string | undefined,
      Year: yearMatch ? Number(yearMatch[1]) : undefined,
      SpeciesCode: SPECIES_CODE,
    };
  });
}

/**
 * Join stratum polygons with stats rows.
 *
 * We deviate from a strictly "one feature per stratum × year" layout because
 * PSEMP has 36 large basin polygons × 26 years = 936 features; duplicating
 * every geometry blows past Node's max string length (~512MB) on stringify
 * and would force the browser to download hundreds of megabytes per page
 * load. Instead we emit one feature per stratum and nest the year series in
 * `statsByYear`. Consumers wanting long-form (row-per-year) data can read
 * `mamu_*_stats_long.json`, which is geometry-free.
 */
function buildJoinedFC(
  strataById: Map<string, GeoJSON.Feature>,
  statsRows: Record<string, unknown>[],
  options: { strataNameField: string },
): {
  joined: GeoJSON.FeatureCollection;
  longRows: Record<string, unknown>[];
  unjoinedRows: Record<string, unknown>[];
} {
  const grouped = new Map<string, Record<string, unknown>[]>();
  const unjoined: Record<string, unknown>[] = [];
  for (const row of statsRows) {
    const sid = String(row['StrataID'] ?? '');
    if (!strataById.has(sid)) {
      unjoined.push(row);
      continue;
    }
    const list = grouped.get(sid) ?? [];
    list.push(row);
    grouped.set(sid, list);
  }

  const features: GeoJSON.Feature[] = [];
  for (const [sid, polygon] of strataById) {
    const rows = grouped.get(sid) ?? [];
    const statsByYear: Record<string, Record<string, unknown>> = {};
    const years: number[] = [];
    for (const row of rows) {
      const yr = row['Year'];
      if (typeof yr !== 'number') continue;
      const { OBJECTID: _oid, StrataID: _sid, Year: _yr, SpeciesName: _sn, SpeciesCode: _sc, ...rest } = row;
      void _oid; void _sid; void _yr; void _sn; void _sc;
      statsByYear[String(yr)] = rest;
      years.push(yr);
    }
    years.sort((a, b) => a - b);
    const baseProps = polygon.properties ?? {};
    const strataName =
      (baseProps[options.strataNameField] as string | undefined) ??
      (rows[0]?.[options.strataNameField] as string | undefined) ??
      `Stratum ${sid}`;
    const latestYear = years.length > 0 ? years[years.length - 1] : null;
    // Flatten the most-recent year's stats to the top level (suffixed
    // `_latest`) so the existing `popupFields` mechanism in src/config/layers
    // can render them without changes. The full time series stays under
    // `statsByYear` for future UI work (year slider, sparkline, etc.).
    const latestFlat: Record<string, unknown> = {};
    if (latestYear !== null) {
      const latest = statsByYear[String(latestYear)] ?? {};
      for (const [k, v] of Object.entries(latest)) {
        latestFlat[`${k}_latest`] = v;
      }
    }
    features.push({
      type: 'Feature',
      geometry: polygon.geometry,
      properties: {
        ...baseProps,
        StrataID: sid,
        StrataName: strataName,
        species: 'Marbled Murrelet',
        speciesCode: SPECIES_CODE,
        years,
        latestYear,
        ...latestFlat,
        statsByYear,
      },
    });
  }
  return {
    joined: { type: 'FeatureCollection', features },
    longRows: statsRows.filter((r) => strataById.has(String(r['StrataID']))),
    unjoinedRows: unjoined,
  };
}

function writeJSON(filename: string, value: unknown): void {
  const fullPath = resolve(outDir, filename);
  writeFileSync(fullPath, JSON.stringify(value), 'utf8');
  console.log(`  → ${fullPath}`);
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });

  // ---- MRB (breeding-season boat surveys, May 15 – Jul 31) ----
  console.log('Fetching MRB strata (3 polygons, EPSG:26910 → 4326)…');
  const mrbStrata = await fetchStrata(`${BASE}/MRB/MapServer`, [
    'OBJECTID',
    'StrataID',
    'StrataName',
  ]);
  writeJSON('wdfw_mrb_strata.geojson', mrbStrata.fc);
  await sleep(250);

  console.log(`Fetching MRB stats for ${SPECIES_CODE}…`);
  const mrbStats = await fetchAllStats(`${BASE}/MRB/MapServer`, 2, [
    'OBJECTID',
    'StrataID',
    'StrataName',
    'Year',
    'SpeciesName',
    'SpeciesCode',
    'EstBirds',
    'Lower',
    'Upper',
    'Density',
    'Density_SE',
    'Density_CV',
  ]);
  console.log(`  ${mrbStats.length} stats rows`);
  const mrbJoin = buildJoinedFC(mrbStrata.byStrataId, mrbStats, {
    strataNameField: 'StrataName',
  });
  console.log(
    `  joined ${mrbJoin.joined.features.length} stratum features (${mrbJoin.unjoinedRows.length} unjoined rows — usually the aggregate StrataID='0')`,
  );
  writeJSON('mamu_mrb_density_by_stratum_year.geojson', mrbJoin.joined);
  writeJSON('mamu_mrb_stats_long.json', {
    species: SPECIES_CODE,
    program: 'MRB',
    rows: mrbJoin.longRows,
  });
  if (mrbJoin.unjoinedRows.length > 0) {
    writeJSON('mamu_mrb_aggregate_stats.json', { rows: mrbJoin.unjoinedRows });
  }
  await sleep(250);

  // ---- PSEMP (winter aerial surveys, Puget Sound Ecosystem Monitoring Program) ----
  console.log('Fetching PSEMP strata (36 polygons, native EPSG:4326)…');
  const psempStrata = await fetchStrata(`${BASE}/PSEMP/MapServer`, [
    'OBJECTID',
    'StrataID',
    'Basin',
    'sqkm',
  ]);
  writeJSON('wdfw_psemp_strata.geojson', psempStrata.fc);
  await sleep(250);

  console.log(`Fetching PSEMP stats for ${SPECIES_CODE}…`);
  const psempStats = await fetchAllStats(`${BASE}/PSEMP/MapServer`, 1, [
    'OBJECTID',
    'StrataID',
    'Year',
    'SpeciesName',
    'SpeciesCode',
    'Basin',
    'Depth',
    'Median',
    'Lower_90',
    'Upper_90',
    'Lower_90_Density',
    'Median_Density',
    'Upper_90_Density',
  ]);
  console.log(`  ${psempStats.length} stats rows`);
  const psempJoin = buildJoinedFC(psempStrata.byStrataId, psempStats, {
    strataNameField: 'Basin',
  });
  console.log(
    `  joined ${psempJoin.joined.features.length} stratum features (${psempJoin.unjoinedRows.length} unjoined rows)`,
  );
  writeJSON('mamu_psemp_density_by_stratum_year.geojson', psempJoin.joined);
  writeJSON('mamu_psemp_stats_long.json', {
    species: SPECIES_CODE,
    program: 'PSEMP',
    rows: psempJoin.longRows,
  });
  if (psempJoin.unjoinedRows.length > 0) {
    writeJSON('mamu_psemp_aggregate_stats.json', { rows: psempJoin.unjoinedRows });
  }
  await sleep(250);

  // ---- Raster catalogs (catalog only — no exportImage downloads) ----
  console.log('Cataloging MRB_MosaicDataset rasters matching MAMU…');
  const mrbCatalog = await fetchMosaicCatalog(`${BASE}/MRB_MosaicDataset/ImageServer`);
  console.log(`  ${mrbCatalog.length} murrelet rasters`);
  writeJSON('wdfw_mrb_mosaic_catalog.json', {
    species: SPECIES_CODE,
    program: 'MRB',
    imageServer: `${BASE}/MRB_MosaicDataset/ImageServer`,
    rasters: mrbCatalog,
  });
  await sleep(250);

  console.log('Cataloging PSEMP_Mosaic rasters matching MAMU…');
  const psempCatalog = await fetchMosaicCatalog(`${BASE}/PSEMP_Mosaic/ImageServer`);
  console.log(`  ${psempCatalog.length} murrelet rasters`);
  writeJSON('wdfw_psemp_mosaic_catalog.json', {
    species: SPECIES_CODE,
    program: 'PSEMP',
    imageServer: `${BASE}/PSEMP_Mosaic/ImageServer`,
    rasters: psempCatalog,
  });

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
