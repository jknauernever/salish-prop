import { useEffect, useRef } from 'react';
import * as turf from '@turf/turf';
import { useMap } from '../../hooks/useMap';
import type { LayerState } from '../../types';
import { extractAllFeatureProperties, getFeatureLabel } from '../../utils/geojson';
import { reverseGeocode } from '../../services/geocode';
import { countIntersectingBuildings, queryShorelineHabitat } from '../../services/popupSpatial';
import type { BuildingQueryResult, ShorelineQueryResult } from '../../services/popupSpatial';

// NDVI parcel stats cache
let ndviStatsCache: Record<string, NdviStats> | null = null;
let ndviStatsFetching = false;
interface NdviStats {
  mean: number;
  stdDev: number;
  water: number;
  bare: number;
  sparse: number;
  moderate: number;
  dense: number;
  veryDense: number;
}

async function getNdviStats(): Promise<Record<string, NdviStats>> {
  if (ndviStatsCache) return ndviStatsCache;
  if (ndviStatsFetching) {
    while (ndviStatsFetching) await new Promise(r => setTimeout(r, 100));
    return ndviStatsCache ?? {};
  }
  ndviStatsFetching = true;
  try {
    const res = await fetch('/data/ndvi_parcel_stats.json');
    ndviStatsCache = await res.json();
    return ndviStatsCache!;
  } catch {
    ndviStatsCache = {};
    return {};
  } finally {
    ndviStatsFetching = false;
  }
}

// Address lookup cache (keyed by parcel PIN)
interface AddressEntry {
  FULLADDR?: string;
  FULLNAME?: string;
  PLACENAME?: string;
  BLDGTYPE?: string;
  MSAG?: string;
  DESCRIPTIO?: string;
  COMMENT?: string;
  ISLAND?: string;
  UNITTYPE?: string;
  UNITID?: string;
}

let addressLookupCache: Record<string, AddressEntry[]> | null = null;
let addressLookupFetching = false;

async function getAddressLookup(): Promise<Record<string, AddressEntry[]>> {
  if (addressLookupCache) return addressLookupCache;
  if (addressLookupFetching) {
    while (addressLookupFetching) await new Promise(r => setTimeout(r, 100));
    return addressLookupCache ?? {};
  }
  addressLookupFetching = true;
  try {
    const res = await fetch('/data/address_lookup.json');
    addressLookupCache = await res.json();
    return addressLookupCache!;
  } catch {
    addressLookupCache = {};
    return {};
  } finally {
    addressLookupFetching = false;
  }
}

// Island-relative percentile index
interface IslandPercentile {
  percentile: number;   // 0-100: greener than X% of properties on this island
  islandName: string;
  islandCount: number;
  islandMedian: number; // median NDVI on this island
}

let islandIndexCache: Map<string, IslandPercentile> | null = null;

function buildIslandIndex(
  ndviStats: Record<string, NdviStats>,
  parcelGeojson: GeoJSON.FeatureCollection,
): Map<string, IslandPercentile> {
  if (islandIndexCache) return islandIndexCache;

  // Build FID -> Tax_Area mapping
  const fidToIsland = new Map<string, string>();
  for (const feat of parcelGeojson.features) {
    const p = feat.properties;
    if (p?.FID != null && p?.Tax_Area) {
      fidToIsland.set(String(p.FID), String(p.Tax_Area).trim());
    }
  }

  // Group NDVI means by island
  const islandGroups = new Map<string, { fid: string; mean: number }[]>();
  for (const [fid, stats] of Object.entries(ndviStats)) {
    const island = fidToIsland.get(fid);
    if (!island) continue;
    if (!islandGroups.has(island)) islandGroups.set(island, []);
    islandGroups.get(island)!.push({ fid, mean: stats.mean });
  }

  // Compute percentiles per island
  const index = new Map<string, IslandPercentile>();
  for (const [island, parcels] of islandGroups) {
    parcels.sort((a, b) => a.mean - b.mean);
    const count = parcels.length;
    const median = parcels[Math.floor(count / 2)].mean;

    for (let i = 0; i < count; i++) {
      index.set(parcels[i].fid, {
        percentile: count > 1 ? Math.round((i / (count - 1)) * 100) : 50,
        islandName: island,
        islandCount: count,
        islandMedian: median,
      });
    }
  }

  islandIndexCache = index;
  return index;
}

// Custom event for triggering a search from a parcel click
export const PARCEL_SEARCH_EVENT = 'parcel-address-search';
export interface ParcelSearchDetail {
  lat: number;
  lng: number;
  formattedAddress: string;
}

// Custom event for opening the tabbed parcel popup at a given coordinate
export const OPEN_PARCEL_POPUP_EVENT = 'open-parcel-popup';
export interface OpenParcelPopupDetail {
  lat: number;
  lng: number;
}

interface FeaturePopupProps {
  layers: LayerState[];
}

export function FeaturePopup({ layers }: FeaturePopupProps) {
  const { map } = useMap();
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;

  useEffect(() => {
    if (!map) return;

    infoWindowRef.current = new google.maps.InfoWindow();

    const listeners: google.maps.MapsEventListener[] = [];

    layers.forEach(layer => {
      if (!layer.dataLayer) return;

      const listener = layer.dataLayer.addListener('click', (event: google.maps.Data.MouseEvent) => {
        const feature = event.feature;
        const props: Record<string, unknown> = {};
        feature.forEachProperty((value, key) => {
          props[key] = value;
        });

        const geoFeature: GeoJSON.Feature = {
          type: 'Feature',
          properties: props,
          geometry: { type: 'Point', coordinates: [0, 0] },
        };

        const label = getFeatureLabel(geoFeature, layer.config.id);
        const fields = extractAllFeatureProperties(geoFeature, layer.config.popupFields);
        const isParcel = layer.config.id === 'tax-parcels';

        if (isParcel) {
          handleParcelClick(
            label, layer, fields, props, event, map,
            infoWindowRef, layersRef.current,
          );
        } else {
          const content = buildPopupHtml(label, layer, fields, null);
          infoWindowRef.current?.setContent(content);
          infoWindowRef.current?.setPosition(event.latLng!);
          infoWindowRef.current?.open(map);
        }
      });

      listeners.push(listener);
    });

    // Register global handlers for "More info" links in popup cards
    (window as unknown as Record<string, unknown>).__openHabitatInfo = openHabitatInfoWindow;
    (window as unknown as Record<string, unknown>).__openNdviInfo = openNdviInfoWindow;

    // Listen for programmatic popup requests (e.g. from address search)
    const popupHandler = (e: Event) => {
      const { lat, lng } = (e as CustomEvent<OpenParcelPopupDetail>).detail;
      openParcelPopupAtCoords(lat, lng, map, infoWindowRef, layersRef.current);
    };
    window.addEventListener(OPEN_PARCEL_POPUP_EVENT, popupHandler);

    return () => {
      listeners.forEach(l => google.maps.event.removeListener(l));
      infoWindowRef.current?.close();
      delete (window as unknown as Record<string, unknown>).__openHabitatInfo;
      delete (window as unknown as Record<string, unknown>).__openNdviInfo;
      window.removeEventListener(OPEN_PARCEL_POPUP_EVENT, popupHandler);
    };
  }, [map, layers]);

  return null;
}

// ---------------------------------------------------------------------------
// Habitat Relevance Score — detailed info window
// ---------------------------------------------------------------------------

function openHabitatInfoWindow() {
  const w = window.open('', '_blank', 'width=720,height=800,scrollbars=yes,resizable=yes');
  if (!w) return;

  w.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Habitat Relevance Score — Data Reference</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Source Sans 3', system-ui, sans-serif; color: #1A2530; padding: 32px 40px; line-height: 1.65; max-width: 680px; margin: 0 auto; }
    h1 { font-size: 24px; font-weight: 700; color: #0D4F4F; margin-bottom: 8px; }
    h2 { font-size: 18px; font-weight: 700; color: #0D4F4F; margin: 28px 0 10px 0; border-bottom: 2px solid #E5E7EB; padding-bottom: 6px; }
    h3 { font-size: 16px; font-weight: 700; color: #1A2530; margin: 20px 0 8px 0; }
    p { font-size: 16px; margin-bottom: 12px; }
    ul, ol { font-size: 16px; margin: 0 0 12px 24px; }
    li { margin-bottom: 6px; }
    .subtitle { font-size: 16px; color: #3D4F5F; margin-bottom: 24px; }
    .highlight { background: rgba(13,79,79,0.08); border-left: 3px solid #0D4F4F; padding: 12px 16px; border-radius: 4px; margin: 16px 0; }
    .highlight p { margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0 16px 0; font-size: 15px; }
    th { text-align: left; font-weight: 700; color: #0D4F4F; padding: 8px 12px; border-bottom: 2px solid #0D4F4F; }
    td { padding: 6px 12px; border-bottom: 1px solid #E5E7EB; }
    .cite { font-size: 14px; color: #3D4F5F; padding: 10px 16px; background: #F8F9FA; border-radius: 6px; margin: 8px 0; line-height: 1.5; }
    a { color: #0D4F4F; }
    .close-btn { position: fixed; top: 16px; right: 20px; background: #0D4F4F; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600; }
    .close-btn:hover { background: #1A7A7A; }
  </style>
</head>
<body>
  <button class="close-btn" onclick="window.close()">Close</button>
  <h1>Habitat Relevance Score</h1>
  <p class="subtitle">Technical reference for fish and forage fish habitat data displayed in the Salish Sea Explorer</p>

  <h2>What the Score Means</h2>
  <p>The <strong>Habitat Relevance Score</strong> represents the <strong>probability of finding a given fish species</strong> at a particular shoreline location during standardized sampling. A score of 40% means that during twice-monthly beach seine surveys from March through October, there was a 40% chance of catching that species at that type of shoreline.</p>
  <p>Scores are derived from the <strong>High Resolution Model (HRM)</strong>, which combines two variables:</p>
  <ul>
    <li><strong>Regional location</strong> (SiteType2) — where the shoreline segment falls within the San Juan Islands (e.g., "San Juan Channel South", "Rosario Strait North")</li>
    <li><strong>Geomorphic shoreline type</strong> (SiteType3) — the physical character of the shoreline (e.g., "pocket estuary like", "barrier beach", "rocky shore")</li>
  </ul>
  <p>The HRM score is the product of the fish presence rate for both variables, yielding a value between 0 and 1. Higher scores indicate shoreline segments where a species is more likely to be present and where habitat conditions are most relevant to that species' life cycle.</p>

  <div class="highlight">
    <p><strong>Example:</strong> A Chinook Salmon HRM of 0.35 means the model predicts a 35% probability of encountering juvenile Chinook at that shoreline type and location during any given sampling event.</p>
  </div>

  <h2>Lower Resolution Model (LRM)</h2>
  <p>The dataset also includes a <strong>Lower Resolution Model (LRM)</strong> score, which uses coarser spatial and habitat variables:</p>
  <ul>
    <li><strong>Spatial variable:</strong> Interior vs. exterior shoreline (relative to the island archipelago)</li>
    <li><strong>Habitat variable:</strong> Enclosure vs. passage (whether the shoreline is in a protected embayment or an open passage)</li>
  </ul>
  <p>The LRM provides a baseline estimate for shoreline segments where fine-scale geomorphic data may be less precise. The Salish Sea Explorer displays the HRM score by default, as it provides higher spatial resolution.</p>

  <h2>Data Collection</h2>
  <h3>Beach Seine Surveys (2008–2009)</h3>
  <p>Researchers conducted <strong>1,350 beach seine sets</strong> across <strong>82 sites</strong> throughout the San Juan Islands during 2008 and 2009. Sites were sampled <strong>twice per month from March through October</strong>, covering the period when juvenile salmon and forage fish are most likely present in nearshore habitats.</p>
  <p>The sampling plan was designed to capture spatial and temporal variation in fish use across a range of shoreline types, from protected pocket estuaries to exposed rocky shores.</p>

  <h3>Species Surveyed</h3>
  <table>
    <tr><th>Species</th><th>HRM Field</th><th>Significance</th></tr>
    <tr><td>Chinook Salmon</td><td>HRM_Ck</td><td>ESA-listed as Threatened; juveniles rear in nearshore habitats</td></tr>
    <tr><td>Chum Salmon</td><td>HRM_Chum</td><td>Depend on estuarine/nearshore transition zones</td></tr>
    <tr><td>Pink Salmon</td><td>HRM_Pk</td><td>Minimal freshwater time; nearshore-critical during outmigration</td></tr>
    <tr><td>Pacific Herring</td><td>HRM_Herr</td><td>Keystone forage fish; spawn on eelgrass/algae</td></tr>
    <tr><td>Pacific Sand Lance</td><td>HRM_Lance</td><td>Spawn in upper intertidal sand-gravel beaches</td></tr>
    <tr><td>Surf Smelt</td><td>HRM_Smelt</td><td>Spawn on mixed sand-gravel beaches</td></tr>
    <tr><td>Lingcod &amp; Greenling</td><td>HRM_Hex</td><td>Use rocky nearshore habitats for spawning/rearing</td></tr>
  </table>

  <h3>Statistical Method</h3>
  <p>Fish presence and abundance data were analyzed using <strong>generalized linear models (GLM)</strong> to test whether spatial (region) and habitat (shoreline type) variables significantly influenced species detection. The resulting models were then applied across all mapped shoreline segments in the San Juan Islands to produce continuous habitat relevance estimates, including for areas that were not directly sampled.</p>

  <h2>Shoreline Geomorphic Classification</h2>
  <p>Each shoreline segment in the dataset is classified using the <strong>SSHIAP Nearshore Geomorphic Classification</strong>, developed by Aundrea McBride at the Skagit River System Cooperative and extended Puget Sound-wide by SSHIAP in 2007–2008.</p>
  <p>The classification uses a formula: <strong>a + b + c = geomorphic unit</strong>, where variables describe landscape processes, sediment dynamics, and coastal landforms. The resulting 19+ geomorphic unit types include:</p>
  <ul>
    <li>Barrier Beach, Depositional Beach, Bluff-Backed Beach</li>
    <li>Pocket Estuary, River Delta, Longshore Lagoon</li>
    <li>Rocky Platform, Rocky Pocket, Open Coastal Inlet</li>
    <li>Tidal Channel, Beach Seep, and others</li>
  </ul>

  <h3>Underlying Data Sources</h3>
  <table>
    <tr><th>Dataset</th><th>Source</th><th>Scale</th></tr>
    <tr><td>Shoreline geology</td><td>WA Dept. of Natural Resources (DNR) 100K geology</td><td>1:100,000</td></tr>
    <tr><td>Net shore-drift</td><td>WA Dept. of Ecology (DOE) Net Shore-Drift</td><td>1:24,000</td></tr>
    <tr><td>Hydrography</td><td>NWIFC SSHIAP / DNR Hydrography</td><td>1:24,000</td></tr>
    <tr><td>Slope classification</td><td>DEM 10m (flat / gentle / steep)</td><td>10 m resolution</td></tr>
    <tr><td>Shoreline inventory</td><td>DNR ShoreZone</td><td>varies</td></tr>
  </table>
  <p>Original source data dates range from <strong>1994 to 2000</strong>. Quality assurance review of geomorphic classifications was conducted between <strong>May 2007 and June 2008</strong>.</p>

  <h2>Programs and Organizations</h2>
  <h3>SSHIAP</h3>
  <p>The <strong>Salmon and Steelhead Habitat Inventory and Assessment Program</strong> was established in 1995 by the Washington Department of Fish and Wildlife (WDFW) and the Western Washington Treaty Indian Tribes. For over 20 years, SSHIAP has provided data management and analysis for ecosystem habitats in freshwater, marine, and nearshore areas, with a focus on salmon and steelhead distribution within western Washington.</p>
  <p>SSHIAP is co-managed by Washington Treaty Indian Tribes (via the Northwest Indian Fisheries Commission, covering WRIAs 1–23) and WDFW (WRIAs 24–62).</p>

  <h3>Skagit River System Cooperative</h3>
  <p>A natural resources management partnership between the Swinomish Indian Tribal Community and the Sauk-Suiattle Indian Tribe, based in La Conner, WA. Conducted the beach seine surveys and developed the habitat relevance models used in this dataset.</p>

  <h2>Citations</h2>
  <div class="cite">
    <strong>Primary Source:</strong><br>
    Beamer, E. and Fresh, K., 2012. <em>Juvenile Salmon and Forage Fish Presence and Abundance in Shoreline Habitats of the San Juan Islands, 2008–2009 — Map Applications for Selected Fish Species.</em> Skagit River System Cooperative, La Conner, WA. 81 pp.<br>
    <a href="https://skagitcoop.org/wp-content/uploads/Beamer_Fresh_2012_Final.pdf" target="_blank">https://skagitcoop.org/wp-content/uploads/Beamer_Fresh_2012_Final.pdf</a>
  </div>
  <div class="cite">
    <strong>Geomorphic Classification Methodology:</strong><br>
    McBride, A. et al., 2009. <em>Developing a Geomorphic Model for Nearshore Habitat Mapping and Analysis.</em> Skagit River System Cooperative / SSHIAP.<br>
    <a href="https://skagitcoop.org/wp-content/uploads/Developing-a-Geomorphic-Model-Methods_101409.pdf" target="_blank">https://skagitcoop.org/wp-content/uploads/Developing-a-Geomorphic-Model-Methods_101409.pdf</a>
  </div>
  <div class="cite">
    <strong>SSHIAP Program:</strong><br>
    Northwest Indian Fisheries Commission. <em>Salmon and Steelhead Habitat Inventory and Assessment Program.</em><br>
    <a href="https://nwifc.org/about-us/environmental-protection/sshiap/" target="_blank">https://nwifc.org/about-us/environmental-protection/sshiap/</a>
  </div>
  <div class="cite">
    <strong>Puget Sound Nearshore Geomorphic Classification:</strong><br>
    Washington Department of Fish &amp; Wildlife, 2021. <em>A Geomorphic Classification of Puget Sound Nearshore Landforms.</em> WDFW Publication No. 02190.<br>
    <a href="https://wdfw.wa.gov/publications/02190" target="_blank">https://wdfw.wa.gov/publications/02190</a>
  </div>

  <h2>Limitations</h2>
  <ul>
    <li>Beach seine sampling was conducted in 2008–2009; species distribution patterns may have shifted since then due to climate change, habitat modification, or population dynamics.</li>
    <li>The HRM model is based on fish <em>presence</em> (detection), not abundance. A high score indicates the species is likely to be encountered, not necessarily in large numbers.</li>
    <li>Scores are modeled estimates, not direct measurements, for most shoreline segments. Only 82 of the 2,842 shoreline segments were directly sampled.</li>
    <li>Forage fish spawning habitat (sand lance, surf smelt) may be more localized than the model resolution can capture.</li>
    <li>Source shoreline geology data dates from 1994–2000; localized changes from development, erosion, or restoration may not be reflected.</li>
  </ul>

  <p style="margin-top:32px;padding-top:16px;border-top:2px solid #E5E7EB;font-size:14px;color:#3D4F5F;">
    Data displayed in the Salish Sea Explorer. For questions about the underlying data, contact the <a href="https://skagitcoop.org" target="_blank">Skagit River System Cooperative</a> or the <a href="https://nwifc.org" target="_blank">Northwest Indian Fisheries Commission</a>.
  </p>
</body>
</html>`);
  w.document.close();
}

// ---------------------------------------------------------------------------
// NDVI & Greenery — detailed info window
// ---------------------------------------------------------------------------

function openNdviInfoWindow() {
  const w = window.open('', '_blank', 'width=720,height=800,scrollbars=yes,resizable=yes');
  if (!w) return;

  w.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Greenery &amp; Tree Cover — Data Reference</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Source Sans 3', system-ui, sans-serif; color: #1A2530; padding: 32px 40px; line-height: 1.65; max-width: 680px; margin: 0 auto; }
    h1 { font-size: 24px; font-weight: 700; color: #0D4F4F; margin-bottom: 8px; }
    h2 { font-size: 18px; font-weight: 700; color: #0D4F4F; margin: 28px 0 10px 0; border-bottom: 2px solid #E5E7EB; padding-bottom: 6px; }
    h3 { font-size: 16px; font-weight: 700; color: #1A2530; margin: 20px 0 8px 0; }
    p { font-size: 16px; margin-bottom: 12px; }
    ul, ol { font-size: 16px; margin: 0 0 12px 24px; }
    li { margin-bottom: 6px; }
    .subtitle { font-size: 16px; color: #3D4F5F; margin-bottom: 24px; }
    .highlight { background: rgba(13,79,79,0.08); border-left: 3px solid #0D4F4F; padding: 12px 16px; border-radius: 4px; margin: 16px 0; }
    .highlight p { margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0 16px 0; font-size: 15px; }
    th { text-align: left; font-weight: 700; color: #0D4F4F; padding: 8px 12px; border-bottom: 2px solid #0D4F4F; }
    td { padding: 6px 12px; border-bottom: 1px solid #E5E7EB; }
    .cite { font-size: 14px; color: #3D4F5F; padding: 10px 16px; background: #F8F9FA; border-radius: 6px; margin: 8px 0; line-height: 1.5; }
    a { color: #0D4F4F; }
    .close-btn { position: fixed; top: 16px; right: 20px; background: #0D4F4F; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600; }
    .close-btn:hover { background: #1A7A7A; }
    .formula { font-family: 'Courier New', monospace; background: #F0F4F8; padding: 12px 16px; border-radius: 6px; margin: 12px 0; font-size: 16px; text-align: center; letter-spacing: 0.5px; }
    .swatch { display: inline-block; width: 14px; height: 14px; border-radius: 3px; vertical-align: middle; margin-right: 6px; }
  </style>
</head>
<body>
  <button class="close-btn" onclick="window.close()">Close</button>
  <h1>Greenery &amp; Tree Cover</h1>
  <p class="subtitle">Technical reference for vegetation analysis displayed in the Salish Sea Explorer</p>

  <h2>What Is NDVI?</h2>
  <p>The <strong>Normalized Difference Vegetation Index (NDVI)</strong> is the standard remote-sensing measure of vegetation health and density. It exploits the fact that healthy green plants strongly absorb visible red light for photosynthesis while reflecting near-infrared (NIR) light. The index is calculated from two spectral bands captured by an aerial or satellite sensor:</p>
  <div class="formula">NDVI = (NIR \u2212 Red) / (NIR + Red)</div>
  <p>NDVI values range from <strong>\u22121 to +1</strong>:</p>
  <ul>
    <li><strong>\u22121 to 0</strong> — Water, bare rock, pavement, buildings, or other non-vegetated surfaces</li>
    <li><strong>0 to 0.2</strong> — Bare soil, sand, or very sparse vegetation</li>
    <li><strong>0.2 to 0.4</strong> — Grass, low shrubs, or stressed vegetation</li>
    <li><strong>0.4 to 0.6</strong> — Moderate vegetation — gardens, mixed shrubs and young trees</li>
    <li><strong>0.6 to 0.8</strong> — Dense, healthy vegetation — mature trees and thick canopy</li>
    <li><strong>0.8 to 1.0</strong> — Very dense forest or peak growing-season canopy</li>
  </ul>

  <div class="highlight">
    <p><strong>Why it matters:</strong> Vegetation cover on a property directly affects stormwater runoff, erosion, carbon sequestration, habitat for wildlife, and water quality in adjacent streams and shoreline. Properties with more tree and plant cover naturally filter rainwater before it reaches the Salish Sea.</p>
  </div>

  <h2>Imagery Source: NAIP</h2>
  <p>The vegetation map shown in the Salish Sea Explorer is derived from the <strong>National Agriculture Imagery Program (NAIP)</strong>, operated by the United States Department of Agriculture (USDA) Farm Service Agency (FSA).</p>

  <h3>About NAIP</h3>
  <ul>
    <li><strong>Coverage:</strong> The continental United States, acquired on a state-by-state cycle</li>
    <li><strong>Resolution:</strong> 0.6 meters per pixel (approximately 2 feet) — high enough to resolve individual trees, driveways, and small structures</li>
    <li><strong>Spectral bands:</strong> Red, Green, Blue, and Near-Infrared (4-band)</li>
    <li><strong>Acquisition:</strong> During the agricultural growing season (leaf-on conditions)</li>
    <li><strong>Image date for San Juan County:</strong> October 2023</li>
  </ul>
  <p>NAIP imagery is collected by aircraft flying at relatively low altitude, producing much sharper images than satellite sensors like Landsat (30 m) or Sentinel-2 (10 m). This allows the Salish Sea Explorer to show vegetation detail at the individual-parcel level.</p>

  <h3>Why October Imagery?</h3>
  <p>The San Juan Islands were captured in early October 2023. While this is late in the growing season, coniferous trees (Douglas fir, western red cedar, shore pine) — the dominant tree species in the San Juans — retain their needles year-round and show strong NDVI values. Deciduous species may show slightly lower values than a mid-summer capture would produce, but the overall vegetation structure is well-represented.</p>

  <h2>How the Greenery Score Is Calculated</h2>

  <h3>Step 1: Compute NDVI for Every Pixel</h3>
  <p>The raw NAIP near-infrared and red bands are used to compute NDVI for every 0.6 m pixel across San Juan County. The result is a continuous raster surface where each pixel has a value between \u22121 and +1.</p>

  <h3>Step 2: Classify Land Cover</h3>
  <p>Each pixel is classified into one of six land cover categories based on its NDVI value:</p>
  <table>
    <tr><th>Class</th><th>NDVI Range</th><th>Typical Cover</th></tr>
    <tr><td><span class="swatch" style="background:#3B82F6;"></span>Water</td><td>&lt; 0</td><td>Open water, tidal pools</td></tr>
    <tr><td><span class="swatch" style="background:#d73027;"></span>Bare / Paved</td><td>0 &ndash; 0.15</td><td>Rooftops, driveways, bare soil, rock</td></tr>
    <tr><td><span class="swatch" style="background:#fc8d59;"></span>Grass / Low Plants</td><td>0.15 &ndash; 0.3</td><td>Lawns, dry grass, sparse groundcover</td></tr>
    <tr><td><span class="swatch" style="background:#a3d977;"></span>Shrubs / Garden</td><td>0.3 &ndash; 0.5</td><td>Ornamental plantings, native shrubs, young trees</td></tr>
    <tr><td><span class="swatch" style="background:#66bd63;"></span>Trees</td><td>0.5 &ndash; 0.7</td><td>Established tree canopy, mixed woodland</td></tr>
    <tr><td><span class="swatch" style="background:#006837;"></span>Dense Forest</td><td>&gt; 0.7</td><td>Mature coniferous or dense mixed forest</td></tr>
  </table>

  <h3>Step 3: Compute Parcel-Level Statistics</h3>
  <p>For each of the approximately 19,000 tax parcels in San Juan County, all pixels that fall within the parcel boundary are aggregated to produce:</p>
  <ul>
    <li><strong>Mean NDVI</strong> — the average greenness across the entire parcel</li>
    <li><strong>Standard deviation</strong> — how variable the vegetation is (a high value means a mix of open and forested areas)</li>
    <li><strong>Land cover percentages</strong> — what fraction of the parcel falls into each of the six classes above</li>
  </ul>

  <h3>Step 4: Island Percentile Ranking</h3>
  <p>Because different islands in the San Juans have different baseline vegetation levels (e.g., Lopez Island has more agricultural land; Orcas Island is more heavily forested), a raw NDVI score alone can be misleading. To provide context, each parcel is ranked against all other parcels <strong>on the same island</strong>.</p>

  <div class="highlight">
    <p><strong>Example:</strong> A parcel on Lopez Island with an NDVI of 0.45 might rank at the 75th percentile for Lopez (greener than 75% of Lopez properties), while the same NDVI on Orcas Island might only rank at the 40th percentile because Orcas has more dense forest on average.</p>
  </div>

  <p>The <strong>island percentile</strong> is the number displayed in the circle on the Greenery &amp; Tree Cover card. It answers the question: <em>"Compared to other properties on my island, how green is mine?"</em></p>
  <p>The rating labels (Well Below Average through Among the Greenest) are derived from the percentile:</p>
  <table>
    <tr><th>Percentile</th><th>Rating</th></tr>
    <tr><td>0 &ndash; 9</td><td>Well Below Average</td></tr>
    <tr><td>10 &ndash; 24</td><td>Below Average</td></tr>
    <tr><td>25 &ndash; 49</td><td>Average</td></tr>
    <tr><td>50 &ndash; 74</td><td>Above Average</td></tr>
    <tr><td>75 &ndash; 89</td><td>Well Above Average</td></tr>
    <tr><td>90 &ndash; 100</td><td>Among the Greenest</td></tr>
  </table>

  <h2>The NDVI Tile Map</h2>
  <p>The green/yellow/red overlay visible on the map when the "Vegetation Health (NDVI)" layer is enabled shows the full-resolution (0.6 m) NDVI raster, pre-rendered into map tiles. The color gradient follows a standard diverging scheme:</p>
  <ul>
    <li><span class="swatch" style="background:#d73027;"></span><strong>Red</strong> — Bare ground, impervious surfaces, or water (NDVI &lt; 0.15)</li>
    <li><span class="swatch" style="background:#fee08b;"></span><strong>Yellow</strong> — Sparse or stressed vegetation (NDVI 0.15 &ndash; 0.35)</li>
    <li><span class="swatch" style="background:#66bd63;"></span><strong>Green</strong> — Healthy vegetation (NDVI 0.35 &ndash; 0.6)</li>
    <li><span class="swatch" style="background:#006837;"></span><strong>Dark green</strong> — Dense, healthy canopy (NDVI &gt; 0.6)</li>
  </ul>
  <p>Tiles are pre-computed at zoom levels 10 through 19 and served from Google Cloud Storage. The overlay is visible starting at zoom level 10 and becomes most useful at zoom levels 15+, where individual parcels are discernible.</p>

  <h2>Sentinel-2 NDVI (Seasonal Comparison)</h2>
  <p>In addition to the high-resolution NAIP layer, the Salish Sea Explorer offers a <strong>Sentinel-2 NDVI</strong> layer that shows vegetation health at 10-meter resolution from the European Space Agency's Copernicus Sentinel-2 satellites.</p>
  <ul>
    <li><strong>Resolution:</strong> 10 meters per pixel</li>
    <li><strong>Revisit frequency:</strong> Every 5 days (combined constellation)</li>
    <li><strong>Date range:</strong> User-selectable — compare vegetation across seasons and years</li>
    <li><strong>Processing:</strong> Computed on-the-fly from cloud-free satellite composites using Google Earth Engine</li>
  </ul>
  <p>While lower resolution than NAIP, Sentinel-2's frequent revisits allow tracking seasonal vegetation change — for example, comparing summer leaf-on versus winter conditions, or monitoring recovery after a storm or land clearing event.</p>

  <h2>Why Vegetation Matters for the Salish Sea</h2>

  <h3>Stormwater &amp; Water Quality</h3>
  <p>Vegetation intercepts rainfall and allows it to infiltrate the soil rather than running off across pavement into storm drains and ultimately into the marine environment. In the San Juan Islands, where many properties drain directly to marine shoreline, tree canopy and native plantings are the primary natural filter for pollutants including:</p>
  <ul>
    <li>Sediment and turbidity</li>
    <li>Nutrients (nitrogen and phosphorus from lawns and septic systems)</li>
    <li>Heavy metals and hydrocarbons from roads and driveways</li>
    <li>Bacteria from pet waste and failing septic systems</li>
  </ul>

  <h3>Shoreline Stability</h3>
  <p>Root systems of native trees and shrubs stabilize soil on slopes and bluffs. Properties with less vegetation near the shoreline are more susceptible to erosion, which can damage nearshore habitat, increase sedimentation, and trigger the perceived need for shoreline armoring — which further degrades habitat for forage fish and salmon.</p>

  <h3>Wildlife Habitat</h3>
  <p>Tree canopy and native understory provide critical habitat for birds, pollinators, and other wildlife. The San Juan Islands support bald eagles, great blue herons, band-tailed pigeons, and dozens of migratory songbird species that depend on forest cover.</p>

  <h3>Carbon Sequestration</h3>
  <p>Mature forests and vegetated areas actively remove carbon dioxide from the atmosphere. Dense forest on San Juan County parcels represents a meaningful carbon sink at the community scale.</p>

  <h2>Data Sources &amp; Processing</h2>
  <table>
    <tr><th>Component</th><th>Source</th><th>Date</th><th>Resolution</th></tr>
    <tr><td>Aerial imagery</td><td>USDA NAIP via Google Earth Engine</td><td>October 2023</td><td>0.6 m</td></tr>
    <tr><td>NDVI raster</td><td>Computed from NAIP NIR &amp; Red bands</td><td>October 2023</td><td>0.6 m</td></tr>
    <tr><td>Parcel boundaries</td><td>San Juan County GIS (Tax Parcels)</td><td>2024</td><td>Vector</td></tr>
    <tr><td>Parcel statistics</td><td>Zonal statistics (mean, std dev, land cover %)</td><td>Computed 2024</td><td>Per-parcel</td></tr>
    <tr><td>Sentinel-2 imagery</td><td>ESA Copernicus via Google Earth Engine</td><td>User-selected</td><td>10 m</td></tr>
    <tr><td>Map tiles</td><td>Pre-rendered to Google Cloud Storage</td><td>—</td><td>Zoom 10–19</td></tr>
  </table>

  <h2>Citations</h2>
  <div class="cite">
    <strong>NAIP Imagery Program:</strong><br>
    USDA Farm Service Agency, 2023. <em>National Agriculture Imagery Program (NAIP).</em><br>
    <a href="https://naip-usdaonline.hub.arcgis.com/" target="_blank">https://naip-usdaonline.hub.arcgis.com/</a>
  </div>
  <div class="cite">
    <strong>NDVI Methodology:</strong><br>
    Rouse, J.W., Haas, R.H., Schell, J.A., and Deering, D.W., 1974. "Monitoring Vegetation Systems in the Great Plains with ERTS." <em>Proceedings, Third Earth Resources Technology Satellite-1 Symposium</em>, NASA SP-351, Vol. 1, pp. 309–317. Goddard Space Flight Center, Washington, D.C.<br>
    <em>The paper that introduced NDVI — now one of the most widely used indices in Earth observation.</em>
  </div>
  <div class="cite">
    <strong>Sentinel-2 Mission:</strong><br>
    European Space Agency, 2015–present. <em>Copernicus Sentinel-2 Mission.</em><br>
    <a href="https://sentinel.esa.int/web/sentinel/missions/sentinel-2" target="_blank">https://sentinel.esa.int/web/sentinel/missions/sentinel-2</a>
  </div>
  <div class="cite">
    <strong>Google Earth Engine:</strong><br>
    Gorelick, N. et al., 2017. "Google Earth Engine: Planetary-scale geospatial analysis for everyone." <em>Remote Sensing of Environment</em>, 202, pp. 18–27.<br>
    <a href="https://doi.org/10.1016/j.rse.2017.06.031" target="_blank">https://doi.org/10.1016/j.rse.2017.06.031</a>
  </div>
  <div class="cite">
    <strong>San Juan County Parcel Data:</strong><br>
    San Juan County GIS (SJCGIS). <em>Tax Parcels.</em><br>
    <a href="https://data2017-01-09t190539232z-sjcgis.opendata.arcgis.com/" target="_blank">https://data2017-01-09t190539232z-sjcgis.opendata.arcgis.com/</a>
  </div>

  <h2>Limitations</h2>
  <ul>
    <li>NAIP imagery was captured in <strong>October 2023</strong>. Vegetation conditions may differ from the current state due to recent land clearing, construction, storm damage, or new plantings.</li>
    <li>October capture date means some deciduous trees (maples, alders) may appear less green than during peak summer. Evergreen conifers, the dominant tree species, are not affected.</li>
    <li>NDVI measures <em>greenness</em>, not species composition. A well-watered lawn scores similarly to a native meadow — it cannot distinguish invasive species from native plantings.</li>
    <li>Shadows from buildings, terrain, or clouds can reduce NDVI values and cause pixels to be misclassified as bare ground or sparse vegetation.</li>
    <li>The 0.6 m pixel size means very small features (individual shrubs, narrow hedgerows) may not be resolved accurately.</li>
    <li>Parcel statistics are based on the legal parcel boundary, which may not precisely match the actual maintained property boundary.</li>
    <li>The island percentile ranking compares properties of all sizes. A large forested lot and a small residential lot are compared on the same scale.</li>
    <li>Sentinel-2 NDVI (10 m resolution) is significantly coarser than NAIP and should not be used for parcel-level analysis — it is best for landscape-scale seasonal comparison.</li>
  </ul>

  <p style="margin-top:32px;padding-top:16px;border-top:2px solid #E5E7EB;font-size:14px;color:#3D4F5F;">
    Data displayed in the Salish Sea Explorer. NAIP imagery is public domain, provided by the USDA. Sentinel-2 data is provided free of charge by the European Space Agency under the Copernicus Programme.
  </p>
</body>
</html>`);
  w.document.close();
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const FONT = "'Source Sans 3', system-ui, sans-serif";
const COLOR = { dark: '#1A2530', mid: '#3D4F5F', light: '#ADB5BD', teal: '#0D4F4F', bg: '#F8F9FA', border: '#E5E7EB' };

const CARD = `background:${COLOR.bg};border-radius:8px;padding:14px 16px;margin-bottom:12px;`;
const HEADING = `font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:${COLOR.dark};margin:0 0 10px 0;`;
const BODY = `font-size:16px;color:${COLOR.dark};line-height:1.55;margin:0;`;
const PILL = `display:inline;color:${COLOR.teal};font-weight:700;font-size:16px;`;
const BIG_NUM = `font-size:32px;font-weight:700;color:${COLOR.teal};line-height:1;`;

function pill(text: string): string {
  return `<span style="${PILL}">${esc(text)}</span>`;
}

function bigStat(value: string, label: string): string {
  return `
    <div style="text-align:center;">
      <div style="${BIG_NUM}">${esc(value)}</div>
      <div style="font-size:14px;color:${COLOR.mid};margin-top:4px;font-weight:600;">${esc(label)}</div>
    </div>
  `;
}

function sectionHeading(text: string): string {
  return `<div style="${HEADING}">${esc(text)}</div>`;
}

function fmtCurrency(value: unknown): string {
  const n = Number(value);
  if (!n || isNaN(n)) return '$0';
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return '$' + (m % 1 === 0 ? m.toFixed(0) : m.toFixed(1).replace(/\.0$/, '')) + 'M';
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return '$' + (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, '')) + 'k';
  }
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtAcres(value: unknown): string {
  const n = Number(value);
  if (!n || isNaN(n)) return '0';
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

function esc(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function setAddressLink(
  el: HTMLElement,
  address: string,
  lat: number,
  lng: number,
  infoWindowRef: React.RefObject<google.maps.InfoWindow | null>,
) {
  el.innerHTML = '';
  const link = document.createElement('a');
  link.textContent = address;
  link.href = '#';
  link.style.color = COLOR.teal;
  link.style.fontStyle = 'normal';
  link.style.textDecoration = 'underline';
  link.style.textDecorationColor = '#0D4F4F40';
  link.style.cursor = 'pointer';
  link.title = 'Search this address';

  link.addEventListener('click', (e) => {
    e.preventDefault();
    infoWindowRef.current?.close();
    window.dispatchEvent(new CustomEvent(PARCEL_SEARCH_EVENT, {
      detail: { lat, lng, formattedAddress: address } satisfies ParcelSearchDetail,
    }));
  });

  el.appendChild(link);
}

// ---------------------------------------------------------------------------
// Programmatic parcel popup (triggered by address search)
// ---------------------------------------------------------------------------

function openParcelPopupAtCoords(
  lat: number,
  lng: number,
  map: google.maps.Map,
  infoWindowRef: React.RefObject<google.maps.InfoWindow | null>,
  allLayers: LayerState[],
) {
  const parcelLayer = allLayers.find(l => l.config.id === 'tax-parcels');
  if (!parcelLayer?.geojsonData) return;

  // Find the parcel containing the searched point
  const point = turf.point([lng, lat]);
  let matchedFeature: GeoJSON.Feature | null = null;

  for (const feature of parcelLayer.geojsonData.features) {
    if (!feature.geometry || (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon')) continue;
    try {
      if (turf.booleanPointInPolygon(point, feature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>)) {
        matchedFeature = feature;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!matchedFeature?.properties) return;

  const props: Record<string, unknown> = { ...matchedFeature.properties };
  const geoFeature: GeoJSON.Feature = {
    type: 'Feature',
    properties: props,
    geometry: { type: 'Point', coordinates: [0, 0] },
  };

  const label = getFeatureLabel(geoFeature, parcelLayer.config.id);
  const fields = extractAllFeatureProperties(geoFeature, parcelLayer.config.popupFields);

  // Create a synthetic event with the searched position
  const latLng = new google.maps.LatLng(lat, lng);
  const syntheticEvent = { latLng } as google.maps.Data.MouseEvent;

  handleParcelClick(label, parcelLayer, fields, props, syntheticEvent, map, infoWindowRef, allLayers);
}

// ---------------------------------------------------------------------------
// Parcel click handler
// ---------------------------------------------------------------------------

function handleParcelClick(
  label: string,
  layer: LayerState,
  fields: { label: string; value: string }[],
  props: Record<string, unknown>,
  event: google.maps.Data.MouseEvent,
  map: google.maps.Map,
  infoWindowRef: React.RefObject<google.maps.InfoWindow | null>,
  allLayers: LayerState[],
) {
  const accentColor = layer.config.style.strokeColor || layer.config.style.fillColor;
  const popupId = `parcel-${Date.now()}`;
  const addressRowId = `${popupId}-address`;

  const parcelGeoFeature = findParcelGeometry(layer, props);

  const content = buildTabbedPopupHtml(label, layer, fields, addressRowId, popupId);
  infoWindowRef.current?.setContent(content);
  infoWindowRef.current?.setPosition(event.latLng!);
  infoWindowRef.current?.open(map);

  const domReadyListener = google.maps.event.addListener(
    infoWindowRef.current!, 'domready', () => {
      attachTabHandlers(popupId, accentColor);
      if (parcelGeoFeature) {
        renderPropertySnapshot(popupId, parcelGeoFeature, allLayers);
      }
      google.maps.event.removeListener(domReadyListener);
    },
  );

  // Address lookup: try local PIN lookup first, fall back to Google reverse geocode
  const pin = String(props.PIN || '').trim();
  const clickLat = event.latLng?.lat() ?? 0;
  const clickLng = event.latLng?.lng() ?? 0;

  getAddressLookup().then(lookup => {
    const entries = pin ? (lookup[pin] || []) : [];
    const el = document.getElementById(addressRowId);
    if (!el) return;

    if (entries.length > 0) {
      const primary = entries[0];
      const address = primary.FULLADDR || '';
      setAddressLink(el, address, clickLat, clickLng, infoWindowRef);
    } else if (event.latLng) {
      // Fall back to Google reverse geocode
      reverseGeocode(clickLat, clickLng).then(address => {
        const addrEl = document.getElementById(addressRowId);
        if (!addrEl) return;
        if (!address) {
          addrEl.textContent = 'Address not found';
          addrEl.style.color = COLOR.light;
          addrEl.style.fontStyle = 'italic';
          return;
        }
        setAddressLink(addrEl, address, clickLat, clickLng, infoWindowRef);
      });
    }
  });

  // Run spatial queries + address-enriched summary
  if (parcelGeoFeature) {
    requestAnimationFrame(() => {
      const buildingResult = runBuildingQuery(parcelGeoFeature, allLayers, popupId);
      const shorelineResult = runShorelineQuery(parcelGeoFeature, allLayers, popupId);
      // Initial render without NDVI or address data
      renderSummary(popupId, props, buildingResult, shorelineResult, null, null, null);

      const fid = String(props.FID ?? '');
      // Load NDVI stats and address data in parallel
      const ndviPromise = fid ? getNdviStats() : Promise.resolve({} as Record<string, NdviStats>);
      const addrPromise = pin ? getAddressLookup() : Promise.resolve({} as Record<string, AddressEntry[]>);

      Promise.all([ndviPromise, addrPromise]).then(([stats, addrLookup]) => {
        const ndvi = fid ? (stats[fid] ?? null) : null;
        let island: IslandPercentile | null = null;
        if (fid) {
          const parcelLayer = allLayers.find(l => l.config.id === 'tax-parcels');
          if (parcelLayer?.geojsonData) {
            const index = buildIslandIndex(stats, parcelLayer.geojsonData);
            island = index.get(fid) ?? null;
          }
        }
        const addrEntries = pin ? (addrLookup[pin] || null) : null;
        renderSummary(popupId, props, buildingResult, shorelineResult, ndvi, island, addrEntries);
      });
    });
  } else {
    const bEl = document.getElementById(`${popupId}-buildings`);
    if (bEl) bEl.innerHTML = `<span style="color:${COLOR.light};font-style:italic;">Spatial data unavailable</span>`;
    const sEl = document.getElementById(`${popupId}-shoreline`);
    if (sEl) sEl.innerHTML = `<span style="color:${COLOR.light};font-style:italic;">Spatial data unavailable</span>`;
    renderSummary(popupId, props, null, null, null, null, null);
  }
}

function findParcelGeometry(
  layer: LayerState,
  clickProps: Record<string, unknown>,
): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null {
  if (!layer.geojsonData) return null;
  const fid = clickProps.FID;
  if (fid == null) return null;
  const match = layer.geojsonData.features.find(f => f.properties?.FID === fid);
  if (!match?.geometry) return null;
  if (match.geometry.type !== 'Polygon' && match.geometry.type !== 'MultiPolygon') return null;
  return match as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
}

function runBuildingQuery(
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  layers: LayerState[],
  popupId: string,
): BuildingQueryResult | null {
  const el = document.getElementById(`${popupId}-buildings`);
  const buildingLayer = layers.find(l => l.config.id === 'building-footprints');
  if (!buildingLayer?.loaded || !buildingLayer.geojsonData) {
    if (el) el.innerHTML = `<div style="${CARD}"><p style="${BODY};color:${COLOR.light};font-style:italic;">Building data not loaded</p></div>`;
    return null;
  }

  const result = countIntersectingBuildings(parcel, buildingLayer);
  if (el) {
    el.innerHTML = buildBuildingsTab(result);
  }
  return result;
}

function runShorelineQuery(
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  layers: LayerState[],
  popupId: string,
): ShorelineQueryResult | null {
  const el = document.getElementById(`${popupId}-shoreline`);
  const hasFishLayer = layers.some(l => l.config.category === 'fish-habitat' && l.loaded && l.geojsonData);
  if (!hasFishLayer) {
    if (el) el.innerHTML = `<div style="${CARD}"><p style="${BODY};color:${COLOR.mid};">Turn on a Fish Habitat layer in the sidebar to see shoreline analysis for this property.</p></div>`;
    return null;
  }

  const result = queryShorelineHabitat(parcel, layers);
  if (el) {
    if (result.species.length === 0) {
      el.innerHTML = `<div style="${CARD}"><p style="${BODY};color:${COLOR.mid};">No mapped fish habitat was found along the shoreline near this property.</p></div>`;
    } else {
      el.innerHTML = buildShorelineTab(result);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

function attachTabHandlers(popupId: string, accentColor: string) {
  const popupEl = document.getElementById(popupId);
  if (!popupEl) return;
  const tabBar = document.getElementById(`${popupId}-tabs`);
  if (!tabBar) return;

  const buttons = tabBar.querySelectorAll<HTMLButtonElement>('button[data-tab]');
  const panels = popupEl.querySelectorAll<HTMLDivElement>('[data-panel]');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab');
      buttons.forEach(b => {
        b.style.color = COLOR.mid;
        b.style.borderBottomColor = 'transparent';
      });
      btn.style.color = COLOR.dark;
      btn.style.borderBottomColor = accentColor;
      panels.forEach(p => {
        p.style.display = p.getAttribute('data-panel') === target ? 'block' : 'none';
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Property snapshot mini-map
// ---------------------------------------------------------------------------

function renderPropertySnapshot(
  popupId: string,
  parcelFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  allLayers: LayerState[],
) {
  const container = document.getElementById(`${popupId}-snapshot`);
  if (!container) return;

  // Compute parcel bounds
  const bounds = new google.maps.LatLngBounds();
  function addCoords(coords: unknown) {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number') {
      bounds.extend({ lat: coords[1] as number, lng: coords[0] as number });
    } else {
      for (const child of coords) addCoords(child);
    }
  }
  addCoords((parcelFeature.geometry as GeoJSON.Geometry & { coordinates: unknown }).coordinates);

  if (bounds.isEmpty()) return;

  // Clear loading text
  container.innerHTML = '';

  // Create mini-map
  const miniMap = new google.maps.Map(container, {
    center: bounds.getCenter(),
    mapTypeId: google.maps.MapTypeId.SATELLITE,
    disableDefaultUI: true,
    gestureHandling: 'none',
    clickableIcons: false,
    keyboardShortcuts: false,
  });

  // Fit to parcel with padding
  miniMap.fitBounds(bounds, 30);

  // Add NDVI tile overlay (1m NAIP data)
  const ndviOverlay = new google.maps.ImageMapType({
    getTileUrl(coord, zoom) {
      if (zoom < 10 || zoom > 19) return null;
      return `https://storage.googleapis.com/salish-ndvi-tiles/ndvi/${zoom}/${coord.x}/${coord.y}.png`;
    },
    tileSize: new google.maps.Size(256, 256),
    opacity: 0.75,
    name: 'ndvi-snapshot',
  });
  miniMap.overlayMapTypes.insertAt(0, ndviOverlay);

  // Clip NDVI to parcel shape: bounded mask rect with parcel hole cut out
  // Compute parcel bounding box
  const allCoords: number[][] = parcelFeature.geometry.type === 'Polygon'
    ? (parcelFeature.geometry.coordinates[0] as number[][])
    : (parcelFeature.geometry as GeoJSON.MultiPolygon).coordinates.flatMap(p => p[0] as number[][]);
  let mnLat = 90, mxLat = -90, mnLng = 180, mxLng = -180;
  for (const c of allCoords) {
    if (c[1] < mnLat) mnLat = c[1];
    if (c[1] > mxLat) mxLat = c[1];
    if (c[0] < mnLng) mnLng = c[0];
    if (c[0] > mxLng) mxLng = c[0];
  }
  const pad = 0.5; // ~0.5 degree padding to cover mini-map viewport
  // Outer rect: clockwise (Google Maps convention for exterior path)
  const outerPath = [
    new google.maps.LatLng(mnLat - pad, mnLng - pad), // SW
    new google.maps.LatLng(mxLat + pad, mnLng - pad), // NW
    new google.maps.LatLng(mxLat + pad, mxLng + pad), // NE
    new google.maps.LatLng(mnLat - pad, mxLng + pad), // SE
  ];
  // Parcel rings: ensure counter-clockwise (Google Maps convention for holes)
  // Compute signed area to detect winding, reverse if needed
  function ringIsClockwise(coords: number[][]): boolean {
    let sum = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const [x1, y1] = coords[i];
      const [x2, y2] = coords[i + 1];
      sum += (x2 - x1) * (y2 + y1);
    }
    return sum > 0;
  }
  const rawRings: number[][][] = parcelFeature.geometry.type === 'Polygon'
    ? [parcelFeature.geometry.coordinates[0] as number[][]]
    : (parcelFeature.geometry as GeoJSON.MultiPolygon).coordinates.map(p => p[0] as number[][]);
  const parcelRings: google.maps.LatLng[][] = rawRings.map(ring => {
    // Hole must be CCW; if ring is CW (positive signed area), it's already CW — need to reverse
    // If ring is CCW (negative signed area), reverse to make CW — wait, we need CCW for holes
    // Actually: ringIsClockwise uses the shoelace formula on [lng,lat] coords.
    // For Google Maps holes, we need the LatLng path to be counter-clockwise on the map.
    // Since GeoJSON coords are [lng,lat], CW in [lng,lat] = CW on map. We want CCW on map.
    const cw = ringIsClockwise(ring);
    const ordered = cw ? ring.slice().reverse() : ring;
    return ordered.map(c => new google.maps.LatLng(c[1], c[0]));
  });

  new google.maps.Polygon({
    paths: [outerPath, ...parcelRings],
    fillColor: '#F0F2F5',
    fillOpacity: 1,
    strokeWeight: 0,
    clickable: false,
    map: miniMap,
  });

  // Add parcel boundary stroke
  const parcelData = new google.maps.Data({ map: miniMap });
  parcelData.addGeoJson({ type: 'FeatureCollection', features: [parcelFeature] });
  parcelData.setStyle({
    fillOpacity: 0,
    strokeColor: '#0A1628',
    strokeWeight: 2.5,
  });

  // Add building footprints within the parcel bounds
  const buildingLayer = allLayers.find(l => l.config.id === 'building-footprints');
  if (buildingLayer?.geojsonData) {
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const parcelBbox: [number, number, number, number] = [sw.lng(), sw.lat(), ne.lng(), ne.lat()];

    const nearbyBuildings: GeoJSON.Feature[] = [];
    for (const feat of buildingLayer.geojsonData.features) {
      if (!feat.geometry) continue;
      // Quick bbox check
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
      function scanCoords(c: unknown) {
        if (!Array.isArray(c)) return;
        if (typeof c[0] === 'number') {
          if (c[0] < minLng) minLng = c[0];
          if (c[0] > maxLng) maxLng = c[0];
          if (c[1] < minLat) minLat = c[1];
          if (c[1] > maxLat) maxLat = c[1];
        } else {
          for (const child of c) scanCoords(child);
        }
      }
      scanCoords((feat.geometry as GeoJSON.Geometry & { coordinates: unknown }).coordinates);
      // Check overlap with parcel bbox (with small buffer)
      if (maxLng < parcelBbox[0] || minLng > parcelBbox[2] || maxLat < parcelBbox[1] || minLat > parcelBbox[3]) continue;
      nearbyBuildings.push(feat);
    }

    if (nearbyBuildings.length > 0) {
      const buildingData = new google.maps.Data({ map: miniMap });
      buildingData.addGeoJson({ type: 'FeatureCollection', features: nearbyBuildings });
      buildingData.setStyle({
        fillColor: '#60A5FA',
        fillOpacity: 0.7,
        strokeColor: '#1E3A5F',
        strokeWeight: 1,
        clickable: false,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Popup shell
// ---------------------------------------------------------------------------

function buildTabbedPopupHtml(
  label: string,
  layer: LayerState,
  fields: { label: string; value: string }[],
  addressRowId: string,
  popupId: string,
): string {
  const accentColor = layer.config.style.strokeColor || layer.config.style.fillColor;

  const tabBtn = (name: string, dataTab: string, active: boolean) => `
    <button data-tab="${dataTab}" style="
      padding:8px 14px; font-size:15px; font-weight:600; cursor:pointer;
      border:none; background:none;
      color:${active ? COLOR.dark : COLOR.mid};
      border-bottom:2px solid ${active ? accentColor : 'transparent'};
      transition:all 0.15s;
    ">${esc(name)}</button>
  `;

  const propertyContent = buildPropertyTab(fields, addressRowId);
  const panelStyle = 'min-height:520px;max-height:520px;overflow-y:auto;padding:8px 4px;';

  return `
    <div id="${popupId}" style="font-family:${FONT};width:580px;">
      <div style="font-weight:700;font-size:18px;color:${COLOR.dark};margin-bottom:2px;">
        ${esc(label)}
      </div>
      <div style="font-size:14px;color:${COLOR.mid};margin-bottom:8px;">
        ${esc(layer.config.name)}
      </div>

      <div style="display:flex;border-bottom:1px solid ${COLOR.border};margin-bottom:8px;" id="${popupId}-tabs">
        ${tabBtn('Summary', 'summary', true)}
        ${tabBtn('Property', 'property', false)}
        ${tabBtn('Buildings', 'buildings', false)}
        ${tabBtn('Shoreline', 'shoreline', false)}
      </div>

      <div data-panel="summary" style="display:block;${panelStyle}">
        <div id="${popupId}-snapshot" style="width:100%;height:220px;border-radius:8px;overflow:hidden;margin-bottom:12px;background:${COLOR.bg};display:flex;align-items:center;justify-content:center;">
          <span style="font-size:14px;color:${COLOR.light};font-style:italic;">Loading property view...</span>
        </div>
        <div id="${popupId}-summary">
          <div style="${CARD}"><p style="${BODY};color:${COLOR.light};font-style:italic;">Loading property overview...</p></div>
        </div>
      </div>
      <div data-panel="property" style="display:none;${panelStyle}">
        ${propertyContent}
      </div>
      <div data-panel="buildings" style="display:none;${panelStyle}">
        <div id="${popupId}-buildings">
          <div style="${CARD}"><p style="${BODY};color:${COLOR.light};font-style:italic;">Checking for buildings...</p></div>
        </div>
      </div>
      <div data-panel="shoreline" style="display:none;${panelStyle}">
        <div id="${popupId}-shoreline">
          <div style="${CARD}"><p style="${BODY};color:${COLOR.light};font-style:italic;">Analyzing nearby shoreline...</p></div>
        </div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Property tab
// ---------------------------------------------------------------------------

function buildPropertyTab(fields: { label: string; value: string }[], addressRowId: string): string {
  const addressRow = `
    <tr>
      <td style="color:${COLOR.mid};padding:6px 12px 6px 0;vertical-align:top;white-space:nowrap;font-weight:600;">Address</td>
      <td id="${esc(addressRowId)}" style="color:${COLOR.light};padding:6px 0;font-style:italic;">Looking up address...</td>
    </tr>
  `;

  return `
    <div style="${CARD}">
      <table style="font-size:15px;border-collapse:collapse;width:100%;">
        ${addressRow}
        ${fields.map(f => `
          <tr>
            <td style="color:${COLOR.mid};padding:5px 12px 5px 0;vertical-align:top;white-space:nowrap;">${esc(f.label)}</td>
            <td style="color:${COLOR.dark};padding:5px 0;word-break:break-word;">${esc(f.value)}</td>
          </tr>
        `).join('')}
      </table>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Summary tab
// ---------------------------------------------------------------------------

function renderSummary(
  popupId: string,
  props: Record<string, unknown>,
  buildingResult: BuildingQueryResult | null,
  shorelineResult: ShorelineQueryResult | null,
  ndviStats: NdviStats | null,
  islandStats: IslandPercentile | null,
  addrEntries: AddressEntry[] | null,
) {
  const el = document.getElementById(`${popupId}-summary`);
  if (!el) return;

  const cards: string[] = [];

  // --- At a Glance ---
  cards.push(buildAtAGlanceCard(props, buildingResult, addrEntries));

  // --- Shoreline Description ---
  if (shorelineResult?.shorelineDescription) {
    cards.push(buildShorelineDescriptionCard(shorelineResult.shorelineDescription));
  }

  // --- Fish & Wildlife ---
  if (shorelineResult && shorelineResult.species.length > 0) {
    cards.push(buildFishCard(shorelineResult));
  }

  // --- Greenery & Tree Cover ---
  if (ndviStats) {
    cards.push(buildGreeneryCard(ndviStats, Number(props.WF_LGTH) > 0, islandStats));
  }

  el.innerHTML = cards.join('');
}

function buildAtAGlanceCard(
  props: Record<string, unknown>,
  buildingResult: BuildingQueryResult | null,
  addrEntries: AddressEntry[] | null,
): string {
  const acres = fmtAcres(props.Acres || props.Legal_Acre);
  const taxArea = String(props.Tax_Area || '').trim();
  const appraised = Number(props.Appraised_) || 0;
  const wfLength = Number(props.WF_LGTH) || 0;
  const buildings = buildingResult?.count ?? 0;
  const totalSqFt = buildingResult?.totalSqFt ?? 0;

  // Stat boxes row
  const stats: string[] = [];
  stats.push(bigStat(acres, 'Acres'));
  if (buildings > 0) stats.push(bigStat(String(buildings), buildings === 1 ? 'Building' : 'Buildings'));
  if (totalSqFt > 0) stats.push(bigStat(Math.round(totalSqFt).toLocaleString(), 'Sq Ft'));
  if (appraised > 0) stats.push(bigStat(fmtCurrency(appraised), 'Assessed Value'));
  if (wfLength > 0) stats.push(bigStat(Math.round(wfLength) + ' ft', 'Waterfront'));

  const statsRow = `
    <div style="display:flex;justify-content:space-around;gap:8px;margin-bottom:12px;">
      ${stats.map(s => `<div style="flex:1;">${s}</div>`).join('')}
    </div>
  `;

  // Quick details
  const details: string[] = [];
  if (taxArea) details.push(`Located in ${pill(taxArea)}`);
  const description = String(props.Descriptio || '').trim();
  if (description) details.push(`classified as ${pill(description)}`);

  // Building type from address data
  if (addrEntries && addrEntries.length > 0) {
    const bldgType = addrEntries[0].BLDGTYPE;
    if (bldgType) details.push(`${pill(bldgType)} use`);
  }

  const salePrice = Number(props.Sale_Price) || 0;
  const saleDate = String(props.Sale_date || '').trim();

  let detailText = details.length > 0 ? `<p style="${BODY}">${details.join(', ')}.</p>` : '';
  if (salePrice > 0 && saleDate) {
    detailText += `<p style="${BODY};margin-top:4px;">Last sold for ${pill(fmtCurrency(salePrice))} on ${esc(saleDate)}.</p>`;
  }

  // Place name and address from address data
  if (addrEntries && addrEntries.length > 0) {
    const primary = addrEntries[0];
    const placeName = primary.PLACENAME;
    const fullAddr = primary.FULLADDR;
    const community = primary.MSAG;
    const addrParts: string[] = [];
    if (fullAddr) addrParts.push(pill(fullAddr));
    if (placeName) addrParts.push(pill(placeName));
    if (community) addrParts.push(esc(community));
    if (addrParts.length > 0) {
      detailText += `<p style="${BODY};margin-top:4px;">${addrParts.join(', ')}.</p>`;
    }

    // Show additional addresses on this parcel
    if (addrEntries.length > 1) {
      const others = addrEntries.slice(1).filter(e => e.FULLADDR).map(e => e.FULLADDR!);
      if (others.length > 0) {
        const label = others.length === 1 ? '1 additional address' : `${others.length} additional addresses`;
        detailText += `<p style="${BODY};margin-top:4px;">${pill(label)} on this parcel: ${others.map(a => esc(a)).join(', ')}.</p>`;
      }
    }
  }

  return `
    <div style="${CARD}">
      ${sectionHeading('At a Glance')}
      ${statsRow}
      ${detailText}
    </div>
  `;
}

function buildShorelineDescriptionCard(desc: NonNullable<ShorelineQueryResult['shorelineDescription']>): string {
  const name = desc.name.trim();
  const geoUnit = desc.geoUnit.trim();
  const systemType = desc.systemType.trim();
  const subType = desc.subType.trim();
  const materialClass = desc.materialClass.trim();
  const featureType = desc.featureType.trim();

  if (!name && !geoUnit && !subType && !materialClass) return '';

  const bold = (text: string) => `<strong style="color:${COLOR.teal};font-weight:700;">${esc(text)}</strong>`;

  const sentences: string[] = [];

  // Location + geomorphic unit
  if (name && geoUnit) {
    sentences.push(`The nearest shoreline is located at ${bold(name)}, which is classified as a ${bold(geoUnit)}.`);
  } else if (name) {
    sentences.push(`The nearest shoreline is located at ${bold(name)}.`);
  } else if (geoUnit) {
    sentences.push(`The adjacent shoreline is classified as a ${bold(geoUnit)}.`);
  }

  // System type + sub type
  if (systemType && subType) {
    sentences.push(`It is part of a ${bold(systemType)} system, specifically a ${bold(subType)}.`);
  } else if (systemType) {
    sentences.push(`It is part of a ${bold(systemType)} system.`);
  } else if (subType) {
    sentences.push(`The shoreline is classified as a ${bold(subType)}.`);
  }

  // Bottom material
  if (materialClass) {
    sentences.push(`The bottom material is ${bold(materialClass)}.`);
  }

  // Feature type
  if (featureType) {
    sentences.push(`The shoreline feature type is ${bold(featureType)}.`);
  }

  return `
    <div style="${CARD}">
      ${sectionHeading('Shoreline Description')}
      <p style="${BODY}">${sentences.join(' ')}</p>
    </div>
  `;
}

function buildGreeneryCard(stats: NdviStats, isWaterfront: boolean, island: IslandPercentile | null): string {
  const { mean, stdDev, water, bare, sparse, moderate, dense, veryDense } = stats;
  const pct = island?.percentile ?? null;
  const islandName = island?.islandName ?? '';

  // Color based on island percentile (if available) or raw NDVI
  const scoreColor = pct != null
    ? (pct < 15 ? '#d73027' : pct < 30 ? '#fc8d59' : pct < 50 ? '#fee08b' : pct < 70 ? '#d9ef8b' : pct < 85 ? '#66bd63' : '#1a9850')
    : (mean < 0.1 ? '#d73027' : mean < 0.25 ? '#fc8d59' : mean < 0.4 ? '#fee08b' : mean < 0.55 ? '#d9ef8b' : mean < 0.7 ? '#66bd63' : '#1a9850');

  // Island-relative rating and description
  let rating: string;
  let description: string;

  if (pct != null && islandName) {
    if (pct < 10) {
      rating = 'Well Below Average';
      description = `This property has less vegetation than most on ${esc(islandName)}. Most of the land is buildings, pavement, or bare ground. Adding native plants could help absorb rainwater and support local wildlife.`;
    } else if (pct < 25) {
      rating = 'Below Average';
      description = `This property has less greenery than about three-quarters of properties on ${esc(islandName)}. There is room to add native plants that would help absorb rainwater and create habitat.`;
    } else if (pct < 50) {
      rating = 'Average';
      description = `This property has a typical amount of vegetation for ${esc(islandName)}. The existing greenery helps absorb some rainwater and provides basic habitat.`;
    } else if (pct < 75) {
      rating = 'Above Average';
      description = `This property is greener than most on ${esc(islandName)}. The vegetation helps keep rainwater out of the storm drains and provides habitat for birds and pollinators.`;
    } else if (pct < 90) {
      rating = 'Well Above Average';
      description = `This property has more tree and plant cover than the vast majority on ${esc(islandName)}. The canopy significantly reduces runoff and creates valuable wildlife corridors.`;
    } else {
      rating = 'Among the Greenest';
      description = `This property is one of the most heavily vegetated on ${esc(islandName)}. Mature forests like this are the best natural protection against erosion and flooding.`;
    }

    if (isWaterfront && pct < 30) {
      description += ' On waterfront properties, adding native shoreline plantings can reduce polluted runoff reaching the water.';
    }
  } else {
    // Fallback: absolute scale if island data unavailable
    if (mean < 0.15) {
      rating = 'Low';
      description = 'This property has very little tree or plant cover.';
    } else if (mean < 0.35) {
      rating = 'Moderate';
      description = 'This property has a mix of developed and green areas.';
    } else if (mean < 0.55) {
      rating = 'Good';
      description = 'This property has solid tree and plant coverage.';
    } else {
      rating = 'Excellent';
      description = 'This property has dense, healthy vegetation.';
    }
  }

  // Percentile circle (island-relative) or score circle (absolute fallback)
  const displayValue = pct != null ? String(pct) : String(Math.max(0, Math.min(100, Math.round(((mean + 0.1) / 0.9) * 100))));
  const subtitle = pct != null
    ? `Greener than ${pct}% on ${esc(islandName)}`
    : 'Greenery Score (out of 100)';

  const percentileCircle = `
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px;">
      <div style="width:64px;height:64px;border-radius:50%;border:4px solid ${scoreColor};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <div style="text-align:center;">
          <span style="font-size:22px;font-weight:700;color:${COLOR.teal};">${displayValue}</span>
          ${pct != null ? `<div style="font-size:12px;color:${COLOR.mid};margin-top:-2px;">percentile</div>` : ''}
        </div>
      </div>
      <div>
        <div style="font-size:18px;font-weight:700;color:${COLOR.dark};">${esc(rating)}</div>
        <div style="font-size:14px;color:${COLOR.dark};">${subtitle}</div>
      </div>
    </div>
  `;

  // Island comparison bar — show where this property falls among its island
  let comparisonBar = '';
  if (pct != null && islandName && island) {
    const markerPos = Math.max(2, Math.min(98, pct));
    comparisonBar = `
      <div style="margin:12px 0 4px 0;">
        <div style="position:relative;background:linear-gradient(to right, #d73027, #fc8d59, #fee08b, #d9ef8b, #66bd63, #1a9850, #006837);border-radius:4px;height:14px;width:100%;">
          <div style="position:absolute;top:-3px;left:${markerPos}%;transform:translateX(-50%);width:4px;height:20px;background:${COLOR.dark};border-radius:2px;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:3px;">
          <span style="font-size:14px;color:${COLOR.dark};">Least green on ${esc(islandName)}</span>
          <span style="font-size:14px;color:${COLOR.dark};">Most green</span>
        </div>
        <div style="font-size:14px;color:${COLOR.dark};margin-top:4px;text-align:center;">
          Compared to ${island.islandCount.toLocaleString()} properties on ${esc(islandName)}
        </div>
      </div>
    `;
  }

  // Land cover breakdown (if data available)
  const hasClasses = (water + bare + sparse + moderate + dense + veryDense) > 0;
  let classBreakdown = '';
  if (hasClasses) {
    const classes = [
      { label: 'Water', pct: water, color: '#3B82F6' },
      { label: 'Bare / Paved', pct: bare, color: '#d73027' },
      { label: 'Grass / Low Plants', pct: sparse, color: '#fc8d59' },
      { label: 'Shrubs / Garden', pct: moderate, color: '#a3d977' },
      { label: 'Trees', pct: dense, color: '#66bd63' },
      { label: 'Dense Forest', pct: veryDense, color: '#006837' },
    ].filter(c => c.pct >= 1);

    if (classes.length > 0) {
      const barSegs = classes.map(c =>
        `<div style="width:${c.pct}%;background:${c.color};height:100%;" title="${c.label}: ${Math.round(c.pct)}%"></div>`
      ).join('');

      const legend = classes.map(c =>
        `<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;">
          <span style="width:10px;height:10px;border-radius:2px;background:${c.color};display:inline-block;flex-shrink:0;"></span>
          <span style="font-size:14px;color:${COLOR.dark};flex:1;">${c.label}</span>
          <span style="font-size:14px;font-weight:600;color:${COLOR.dark};">${Math.round(c.pct)}%</span>
        </div>`
      ).join('');

      classBreakdown = `
        <div style="margin-top:14px;padding-top:12px;border-top:1px solid ${COLOR.border};">
          <div style="font-size:14px;font-weight:600;color:${COLOR.dark};margin-bottom:8px;">What covers this property</div>
          <div style="display:flex;border-radius:4px;height:16px;overflow:hidden;background:${COLOR.border};margin-bottom:8px;">${barSegs}</div>
          ${legend}
        </div>
      `;
    }
  }

  // Variability note
  let variabilityNote = '';
  if (stdDev > 0.15) {
    variabilityNote = `<p style="font-size:14px;color:${COLOR.dark};margin:10px 0 0 0;">This property has a mix of open and heavily vegetated areas.</p>`;
  }

  const moreInfoLink = `<div style="margin-top:10px;"><a href="#" onclick="window.__openNdviInfo?.();return false;" style="font-size:14px;color:${COLOR.teal};font-weight:600;text-decoration:none;">More about this data \u2192</a></div>`;

  return `
    <div style="${CARD}">
      ${sectionHeading('Greenery & Tree Cover')}
      ${percentileCircle}
      <p style="${BODY}">${description}</p>
      ${comparisonBar}
      ${classBreakdown}
      ${variabilityNote}
      ${moreInfoLink}
    </div>
  `;
}

function buildFishCard(result: ShorelineQueryResult): string {
  const { species } = result;
  const count = species.length;
  const top = species[0];
  const topPct = Math.round(top.hrmValue * 100);

  const intro = count === 1
    ? `The shoreline near this property is habitat for ${pill(top.species)}.`
    : `The shoreline near this property is habitat for ${pill(String(count) + ' fish species')}. ${esc(top.species)} has the highest habitat relevance at ${pill(topPct + '%')}.`;

  const hrmDesc = `Scores show the probability of finding each species during sampling, based on beach seine surveys at 82 sites across the San Juan Islands in 2008\u20132009.`;

  const BAR_COLORS = ['#0D4F4F', '#1A7A7A', '#2A9D8F', '#4DB8A4', '#76C7B7', '#9DD6CB', '#C4E5DF'];

  const bars = species.map((sp, i) => {
    const pct = Math.round(sp.hrmValue * 100);
    const color = BAR_COLORS[i % BAR_COLORS.length];
    return `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <div style="width:120px;font-size:14px;color:${COLOR.dark};text-align:right;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(sp.species)}</div>
        <div style="flex:1;background:${COLOR.border};border-radius:3px;height:14px;overflow:hidden;">
          <div style="background:${color};height:100%;width:${pct}%;border-radius:3px;transition:width 0.3s;"></div>
        </div>
        <div style="width:36px;font-size:14px;font-weight:600;color:${COLOR.dark};flex-shrink:0;">${pct}%</div>
      </div>
    `;
  }).join('');

  const moreInfoLink = `<a href="#" style="color:${COLOR.teal};font-size:14px;text-decoration:underline;cursor:pointer;" onclick="event.preventDefault();window.__openHabitatInfo();">More about this data &rarr;</a>`;

  return `
    <div style="${CARD}">
      ${sectionHeading('Fish & Wildlife Habitat')}
      <p style="${BODY};margin-bottom:8px;">${intro}</p>
      <p style="${BODY};margin-bottom:12px;color:${COLOR.mid};">${hrmDesc} ${moreInfoLink}</p>
      <div style="font-size:14px;color:${COLOR.dark};margin-bottom:6px;">Habitat relevance score</div>
      ${bars}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Shoreline tab (full detail)
// ---------------------------------------------------------------------------

function buildShorelineTab(result: ShorelineQueryResult): string {
  const { species, shorelineDescription } = result;

  const speciesRows = species.map(sp => {
    const pct = Math.round(sp.hrmValue * 100);
    return `
      <tr>
        <td style="color:${COLOR.dark};padding:6px 10px 6px 0;white-space:nowrap;font-size:15px;">${esc(sp.species)}</td>
        <td style="padding:6px 0;width:100%;">
          <div style="display:flex;align-items:center;gap:6px;">
            <div style="background:${COLOR.border};border-radius:3px;height:10px;flex:1;overflow:hidden;">
              <div style="background:${COLOR.teal};height:100%;width:${pct}%;border-radius:3px;"></div>
            </div>
            <span style="font-size:14px;color:${COLOR.dark};min-width:32px;font-weight:600;">${pct}%</span>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  const descHtml = shorelineDescription ? `
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid ${COLOR.border};">
      <div style="font-size:14px;font-weight:600;color:${COLOR.dark};margin-bottom:8px;">Shoreline Details</div>
      <table style="font-size:15px;border-collapse:collapse;width:100%;">
        ${shorelineRow('Location', shorelineDescription.name)}
        ${shorelineRow('Type', shorelineDescription.geoUnit)}
        ${shorelineRow('System', shorelineDescription.systemType)}
        ${shorelineRow('Classification', shorelineDescription.subType)}
        ${shorelineRow('Bottom Material', shorelineDescription.materialClass)}
        ${shorelineRow('Feature', shorelineDescription.featureType)}
      </table>
    </div>
  ` : '';

  return `
    <div style="${CARD}">
      ${sectionHeading('Species Habitat Scores')}
      <p style="${BODY};margin-bottom:10px;">These scores show how important the nearby shoreline is as habitat for each species. Higher scores mean more critical habitat.</p>
      <table style="border-collapse:collapse;width:100%;">
        ${speciesRows}
      </table>
      ${descHtml}
    </div>
  `;
}

function shorelineRow(label: string, value: string): string {
  if (!value || !value.trim()) return '';
  return `
    <tr>
      <td style="color:${COLOR.mid};padding:4px 10px 4px 0;">${esc(label)}</td>
      <td style="color:${COLOR.dark};padding:4px 0;">${esc(value)}</td>
    </tr>
  `;
}

// ---------------------------------------------------------------------------
// Buildings tab
// ---------------------------------------------------------------------------

function buildBuildingsTab(result: BuildingQueryResult): string {
  if (result.count === 0) {
    return `<div style="${CARD}">${bigStat('0', 'Buildings on this property')}<p style="${BODY};color:${COLOR.mid};text-align:center;margin-top:10px;">No building footprints were found within this parcel boundary.</p></div>`;
  }

  const totalSqFt = Math.round(result.totalSqFt);
  const header = `
    <div style="display:flex;justify-content:space-around;gap:8px;margin-bottom:14px;">
      <div style="flex:1;">${bigStat(String(result.count), result.count === 1 ? 'Building' : 'Buildings')}</div>
      ${totalSqFt > 0 ? `<div style="flex:1;">${bigStat(totalSqFt.toLocaleString(), 'Total Sq Ft')}</div>` : ''}
    </div>
  `;

  const rows = result.buildings.map((b, i) => {
    const details: string[] = [];
    if (b.sqFt) details.push(`<strong>${Math.round(b.sqFt).toLocaleString()} sq ft</strong>`);
    if (b.address) details.push(esc(b.address));
    if (b.description) details.push(esc(b.description));
    if (b.source) details.push(`<span style="color:${COLOR.mid};">Source: ${esc(b.source)}</span>`);

    return `
      <div style="padding:10px 0;${i > 0 ? `border-top:1px solid ${COLOR.border};` : ''}">
        <div style="font-size:15px;font-weight:600;color:${COLOR.dark};margin-bottom:4px;">Building ${i + 1}</div>
        <div style="font-size:15px;color:${COLOR.dark};line-height:1.5;">${details.join(' &middot; ')}</div>
      </div>
    `;
  }).join('');

  return `<div style="${CARD}">${header}${rows}</div>`;
}

// ---------------------------------------------------------------------------
// Non-parcel popup
// ---------------------------------------------------------------------------

function buildPopupHtml(
  label: string,
  layer: LayerState,
  fields: { label: string; value: string }[],
  addressRowId: string | null,
): string {
  const accentColor = layer.config.style.strokeColor || layer.config.style.fillColor;

  const addressRow = addressRowId
    ? `<tr>
        <td style="color:${COLOR.mid};padding:5px 10px 5px 0;vertical-align:top;white-space:nowrap;font-weight:600;">Address</td>
        <td id="${esc(addressRowId)}" style="color:${COLOR.light};padding:5px 0;font-style:italic;">Looking up address...</td>
       </tr>`
    : '';

  return `
    <div style="font-family:${FONT};max-width:360px;max-height:400px;overflow-y:auto;">
      <div style="font-weight:700;font-size:18px;color:${COLOR.dark};margin-bottom:6px;border-bottom:2px solid ${accentColor};padding-bottom:4px;">
        ${esc(label)}
      </div>
      <div style="font-size:14px;color:${COLOR.mid};margin-bottom:10px;">
        ${esc(layer.config.name)}
      </div>
      ${(fields.length > 0 || addressRowId) ? `
        <table style="font-size:15px;border-collapse:collapse;width:100%;">
          ${addressRow}
          ${fields.map(f => `
            <tr>
              <td style="color:${COLOR.mid};padding:5px 10px 5px 0;vertical-align:top;white-space:nowrap;">${esc(f.label)}</td>
              <td style="color:${COLOR.dark};padding:5px 0;word-break:break-word;">${esc(f.value)}</td>
            </tr>
          `).join('')}
        </table>
      ` : `<div style="font-size:15px;color:${COLOR.dark};">No additional details available</div>`}
    </div>
  `;
}
