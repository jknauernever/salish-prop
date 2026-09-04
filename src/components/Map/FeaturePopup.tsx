import { useEffect, useRef } from 'react';
import * as turf from '@turf/turf';
import { useMap } from '../../hooks/useMap';
import { buildPopupFrame, installPopupFrameHandlers, POPUP_CLOSE_EVENT, escapeHtml as escHtml } from './popupFrame';
import { MobileSheetWindow, type PopupHost } from './popupSheet';
import { isMobileNow } from '../../hooks/useIsMobile';
import type { PopupPhoto, PopupStat } from './popupFrame';
import { POPUP_SPECS, LAYER_PHOTOS, LAYER_PHOTOS_MORE, PHOTO_SUBJECTS, PHOTO_EXCLUDE, fallbackTitle, fmtAcresValue } from '../../config/popups';
import type { LayerState } from '../../types';
import { extractAllFeatureProperties, getFeatureLabel } from '../../utils/geojson';
import { reverseGeocode } from '../../services/geocode';
import { countIntersectingBuildings, nearshoreFromStats } from '../../services/popupSpatial';
import { getNearshoreStats, DEFAULT_NEARSHORE_META } from '../../services/nearshoreStats';
import { fetchParcelDetail, findParcelAtPoint, getFidToTaxArea } from '../../services/parcelDetail';
import { DECK_CLICK_EVENT, type DeckClickDetail } from './DeckLayers';
import { getFriendsContentSync, preloadFriendsContent, articleForUrl, articleForProject, articlesForFeature, photosForSubject, articleDate, type ContentItem } from '../../services/friendsContent';
import { SHOREFORM_TYPES } from '../../config/shoreforms';
import type { BuildingQueryResult, ShorelineQueryResult, NearshoreVegetationResult } from '../../services/popupSpatial';
import { fetchNearbyBirdSummary } from '../../services/ebird';
import type { BirdSpeciesSummary } from '../../services/ebird';

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
  fidToIsland: Map<string, string>,
): Map<string, IslandPercentile> {
  if (islandIndexCache) return islandIndexCache;

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

// Fired whenever the parcel popup opens (with its anchor) or is closed (null),
// so the URL can mirror which property is being viewed.
export const PARCEL_POPUP_STATE_EVENT = 'parcel-popup-state';
export type ParcelPopupStateDetail = { lat: number; lng: number } | null;
function emitParcelPopupState(detail: ParcelPopupStateDetail) {
  window.dispatchEvent(new CustomEvent<ParcelPopupStateDetail>(PARCEL_POPUP_STATE_EVENT, { detail }));
}

interface FeaturePopupProps {
  layers: LayerState[];
  propertyClick?: boolean;
}

// Highlight helpers live in featureHighlight.ts so other popups (e.g. ForestLossPopup)
// can share the same overlay layer.
import { highlightFeatureGeometry, clearFeatureHighlight } from './featureHighlight';

export function FeaturePopup({ layers, propertyClick = true }: FeaturePopupProps) {
  const { map } = useMap();
  const infoWindowRef = useRef<PopupHost | null>(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;

  // The InfoWindow lives for the lifetime of the map. It must NOT be torn
  // down when `layers` changes — layer loads and toggles happen constantly
  // (including right after a popup is restored from a shared URL), and
  // closing the window on every change made popups vanish.
  useEffect(() => {
    if (!map) return;

    // Phones get the same popup as a bottom sheet instead of a map bubble
    const iw: PopupHost = isMobileNow() ? new MobileSheetWindow() : new google.maps.InfoWindow();
    infoWindowRef.current = iw;
    installPopupFrameHandlers();

    // Clear parcel highlight when popup is closed
    const onClosed = () => {
      clearFeatureHighlight();
      emitParcelPopupState(null);
    };
    iw.addListener('closeclick', onClosed);
    // The frame draws its own close button (Google's is hidden by CSS)
    const onFrameClose = () => {
      if (!iw.isOpen) return;
      iw.close();
      onClosed();
    };
    window.addEventListener(POPUP_CLOSE_EVENT, onFrameClose);

    return () => {
      window.removeEventListener(POPUP_CLOSE_EVENT, onFrameClose);
      iw.close();
      clearFeatureHighlight();
      if (infoWindowRef.current === iw) infoWindowRef.current = null;
    };
  }, [map]);

  // Click handlers are re-registered whenever the set of Data layers changes.
  useEffect(() => {
    if (!map) return;

    const listeners: google.maps.MapsEventListener[] = [];

    layers.forEach(layer => {
      if (!layer.dataLayer) return;
      // eBird hotspots handle their own click (open eBird URL)
      if (layer.config.id === 'ebird-hotspots') return;
      // Multi-source observation layers open their own rich InfoWindow.
      if (layer.config.source === 'observations:multi') return;
      // tax-parcels is the property-details layer; skip click registration when disabled
      if (layer.config.id === 'tax-parcels' && !propertyClick) return;

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
          // Highlight the clicked feature so users can see what their popup describes.
          // toGeoJson is async (callback-based); fire-and-forget — popup opens immediately.
          feature.toGeoJson((json) => {
            highlightFeatureGeometry(json as GeoJSON.Feature, map);
          });
          openFeaturePopup(layer, props, fields, label, event.latLng!, map, infoWindowRef);
        }
      });

      listeners.push(listener);
    });

    // Register global handlers for "More info" links in popup cards
    (window as unknown as Record<string, unknown>).__openHabitatInfo = openHabitatInfoWindow;
    (window as unknown as Record<string, unknown>).__openNdviInfo = openNdviInfoWindow;

    // Listen for programmatic popup requests (e.g. from address search) — only when property details are enabled
    const popupHandler = propertyClick
      ? (e: Event) => {
          const { lat, lng } = (e as CustomEvent<OpenParcelPopupDetail>).detail;
          openParcelPopupAtCoords(lat, lng, map, infoWindowRef, layersRef.current);
        }
      : null;
    if (popupHandler) {
      window.addEventListener(OPEN_PARCEL_POPUP_EVENT, popupHandler);
    }

    // deck.gl tile layers (parcels, buildings) re-broadcast clicks as a window event
    const onDeckClick = (e: Event) => {
      const { layerId, properties, lat, lng } = (e as CustomEvent<DeckClickDetail>).detail;
      const layer = layersRef.current.find(l => l.config.id === layerId);
      if (!layer || !layer.visible) return;
      const props: Record<string, unknown> = { ...properties };
      const geoFeature: GeoJSON.Feature = { type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [0, 0] } };
      const label = getFeatureLabel(geoFeature, layerId);
      const fields = extractAllFeatureProperties(geoFeature, layer.config.popupFields);
      const latLng = new google.maps.LatLng(lat, lng);
      if (layerId === 'tax-parcels') {
        if (!propertyClick) return;
        handleParcelClick(label, layer, fields, props, { latLng } as google.maps.Data.MouseEvent, map, infoWindowRef, layersRef.current);
      } else {
        clearFeatureHighlight();
        openFeaturePopup(layer, props, fields, label, latLng, map, infoWindowRef);
      }
    };
    window.addEventListener(DECK_CLICK_EVENT, onDeckClick);

    return () => {
      window.removeEventListener(DECK_CLICK_EVENT, onDeckClick);
      listeners.forEach(l => google.maps.event.removeListener(l));
      delete (window as unknown as Record<string, unknown>).__openHabitatInfo;
      delete (window as unknown as Record<string, unknown>).__openNdviInfo;
      if (popupHandler) {
        window.removeEventListener(OPEN_PARCEL_POPUP_EVENT, popupHandler);
      }
    };
  }, [map, layers, propertyClick]);

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
    <tr><td>Parcel boundaries</td><td>San Juan County GIS (tax parcels)</td><td>2024</td><td>Vector</td></tr>
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

const FONT = "'Montserrat', system-ui, sans-serif";
// Friends of the San Juans palette (see index.css .ssx-*): ink, warm grays, sea blue, sand
const COLOR = { dark: '#1A1A1A', mid: '#33302A', light: '#7A746B', teal: '#036E88', bg: '#F1E8D6', border: '#E0D6C4' };

const CARD = `background:${COLOR.bg};border-radius:8px;padding:14px 16px;margin-bottom:12px;`;
const HEADING = `font-family:'Montserrat',system-ui,sans-serif;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6A5324;margin:0 0 10px 0;`;
const BODY = `font-size:14.5px;color:${COLOR.dark};line-height:1.55;margin:0;`;
const PILL = `display:inline;color:${COLOR.teal};font-weight:700;font-size:14.5px;`;
const BIG_NUM = `font-family:'Montserrat',system-ui,sans-serif;font-size:30px;font-weight:700;color:${COLOR.teal};line-height:1;`;

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


function fmtAcres(value: unknown): string {
  const n = Number(value);
  if (!n || isNaN(n)) return '0';
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:)\]])/gi;

/**
 * Escape a value for HTML, then turn any http(s):// or www. URLs inside it
 * into links that open in a new tab. Used for every property value we
 * print in a popup — e.g. the Friends restoration projects' LINK field.
 */
function linkify(value: string): string {
  const escaped = esc(value);
  return escaped.replace(URL_RE, (url) => {
    const href = url.startsWith('www.') ? `https://${url}` : url;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color:#0D4F4F;text-decoration:underline;word-break:break-all;">${url}</a>`;
  });
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
  infoWindowRef: React.RefObject<PopupHost | null>,
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
  infoWindowRef: React.RefObject<PopupHost | null>,
  allLayers: LayerState[],
) {
  const parcelLayer = allLayers.find(l => l.config.id === 'tax-parcels');
  if (!parcelLayer) return;

  // Which parcel contains the point: bbox index + per-parcel geometry
  findParcelAtPoint(lat, lng).then(hit => {
    if (!hit || !hit.detail.parcel.properties) return;
    const matchedFeature = hit.detail.parcel;

  const props: Record<string, unknown> = { ...matchedFeature.properties };
  const geoFeature: GeoJSON.Feature = {
    type: 'Feature',
    properties: props,
    geometry: { type: 'Point', coordinates: [0, 0] },
  };

  const label = getFeatureLabel(geoFeature, parcelLayer.config.id);
  const fields = extractAllFeatureProperties(geoFeature, parcelLayer.config.popupFields);

  highlightFeatureGeometry(matchedFeature, map);

  // Create a synthetic event with the searched position
  const latLng = new google.maps.LatLng(lat, lng);
  const syntheticEvent = { latLng } as google.maps.Data.MouseEvent;

  handleParcelClick(label, parcelLayer, fields, props, syntheticEvent, map, infoWindowRef, allLayers);
  });
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
  infoWindowRef: React.RefObject<PopupHost | null>,
  allLayers: LayerState[],
) {
  const accentColor = layer.config.style.strokeColor || layer.config.style.fillColor || '#0D4F4F';
  const popupId = `parcel-${Date.now()}`;
  const addressRowId = `${popupId}-address`;

  // Full geometry + nearby buildings come from a small per-parcel file (the
  // parcels on the map are vector tiles, clipped at tile edges).
  const detailPromise = props.FID != null ? fetchParcelDetail(String(props.FID)) : Promise.resolve(null);
  detailPromise.then(d => { if (d) highlightFeatureGeometry(d.parcel, map); });

  const content = buildTabbedPopupHtml(label, layer, fields, addressRowId, popupId, props);
  infoWindowRef.current?.setContent(content);
  infoWindowRef.current?.setPosition(event.latLng!);
  infoWindowRef.current?.open(map);
  if (event.latLng) emitParcelPopupState({ lat: event.latLng.lat(), lng: event.latLng.lng() });

  const domReadyListener = google.maps.event.addListener(
    infoWindowRef.current!, 'domready', () => {
      attachTabHandlers(popupId, accentColor);
      detailPromise.then(d => { if (d) renderPropertySnapshot(popupId, d.parcel, d.buildings); });
      google.maps.event.removeListener(domReadyListener);
    },
  );

  // Address lookup: try local PIN lookup first, fall back to Google reverse geocode
  const pin = String(props.PIN || '').trim();
  const clickLat = event.latLng?.lat() ?? 0;
  const clickLng = event.latLng?.lng() ?? 0;

  const titleElId = `${popupId}-title`;

  // Wildlife tab: whale / marine mammal sightings live on EarthAtlas, opened at the parcel
  let centroid: number[] = [clickLng, clickLat];
  let popupName = label;
  renderWhaleLink(popupId, centroid[1], centroid[0], popupName);
  detailPromise.then(d => {
    if (!d) return;
    centroid = turf.centroid(d.parcel).geometry.coordinates;
    renderWhaleLink(popupId, centroid[1], centroid[0], popupName);
  });

  const setPopupTitle = (address: string) => {
    const titleEl = document.getElementById(titleElId);
    if (titleEl) titleEl.textContent = address;
    popupName = address || label;
    renderWhaleLink(popupId, centroid[1], centroid[0], popupName);
  };

  getAddressLookup().then(lookup => {
    const entries = pin ? (lookup[pin] || []) : [];
    const el = document.getElementById(addressRowId);
    if (!el) return;

    if (entries.length > 0) {
      const primary = entries[0];
      const address = primary.FULLADDR || '';
      setAddressLink(el, address, clickLat, clickLng, infoWindowRef);
      setPopupTitle(address || label);
    } else if (event.latLng) {
      // Fall back to Google reverse geocode
      reverseGeocode(clickLat, clickLng).then(address => {
        const addrEl = document.getElementById(addressRowId);
        if (!addrEl) return;
        if (!address) {
          addrEl.textContent = 'Address not found';
          addrEl.style.color = COLOR.light;
          addrEl.style.fontStyle = 'italic';
          setPopupTitle(label);
          return;
        }
        setAddressLink(addrEl, address, clickLat, clickLng, infoWindowRef);
        setPopupTitle(address);
      });
    } else {
      setPopupTitle(label);
    }
  });

  // Fetch bird observations (independent of parcel geometry)
  runBirdQuery(clickLat, clickLng, popupId);

  // If the forest-loss raster layer is on, fetch + render a small line
  // describing the loss patch at this click point.
  runForestLossQuery(clickLat, clickLng, popupId, allLayers);

  // Same for the DIST-ALERT raster layer: per-pixel disturbance info.
  runDistAlertQuery(clickLat, clickLng, popupId, allLayers);

  // Run spatial queries + address-enriched summary once the parcel file is here
  detailPromise.then(detail => {
  if (detail) {
    const parcelGeoFeature = detail.parcel;
    requestAnimationFrame(() => {
      const buildingResult = runBuildingQuery(parcelGeoFeature, detail.buildings, popupId);
      const fid = String(props.FID ?? '');
      const sEl = document.getElementById(`${popupId}-shoreline`);
      if (sEl) sEl.innerHTML = `<div style="${CARD}"><p style="${BODY};color:${COLOR.light};font-style:italic;">Checking nearshore habitat…</p></div>`;
      // Initial render without nearshore, NDVI or address data
      renderSummary(popupId, props, buildingResult, null, null, null, null, null);

      // Nearshore habitat comes from the precomputed per-parcel stats file, so
      // it works whether or not the kelp / eelgrass / forage layers are on.
      const nearshorePromise = getNearshoreStats().then(stats =>
        nearshoreFromStats(fid ? stats?.parcels[fid] : undefined, stats?.meta ?? DEFAULT_NEARSHORE_META),
      );
      const ndviPromise = fid ? getNdviStats() : Promise.resolve({} as Record<string, NdviStats>);
      const addrPromise = pin ? getAddressLookup() : Promise.resolve({} as Record<string, AddressEntry[]>);
      const taxAreaPromise = fid ? getFidToTaxArea() : Promise.resolve(new Map<string, string>());

      nearshorePromise.then(vegResult => {
        renderShorelineTab(popupId, vegResult);
        renderFishTab(popupId, vegResult);
        renderModsTab(popupId, vegResult);
        const shorelineResult = null;
        const islandProjects = projectsOnIsland(islandOfParcel(props, null), allLayers);
        renderSummary(popupId, props, buildingResult, shorelineResult, vegResult, null, null, null, islandProjects);

        Promise.all([ndviPromise, addrPromise, taxAreaPromise]).then(([stats, addrLookup, fidToIsland]) => {
          const ndvi = fid ? (stats[fid] ?? null) : null;
          let island: IslandPercentile | null = null;
          if (fid && fidToIsland.size > 0) {
            const index = buildIslandIndex(stats, fidToIsland);
            island = index.get(fid) ?? null;
          }
          const addrEntries = pin ? (addrLookup[pin] || null) : null;
          renderSummary(popupId, props, buildingResult, shorelineResult, vegResult, ndvi, island, addrEntries, projectsOnIsland(islandOfParcel(props, addrEntries), allLayers));
        });
      });
    });
  } else {
    const bEl = document.getElementById(`${popupId}-buildings`);
    if (bEl) bEl.innerHTML = `<span style="color:${COLOR.light};font-style:italic;">Spatial data unavailable</span>`;
    const sEl = document.getElementById(`${popupId}-shoreline`);
    if (sEl) sEl.innerHTML = `<span style="color:${COLOR.light};font-style:italic;">Spatial data unavailable</span>`;
    renderSummary(popupId, props, null, null, null, null, null, null);
  }
  });
}


function runBuildingQuery(
  parcel: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  candidates: GeoJSON.Feature[],
  popupId: string,
): BuildingQueryResult | null {
  const el = document.getElementById(`${popupId}-buildings`);
  const result = countIntersectingBuildings(parcel, candidates);
  if (el) {
    el.innerHTML = buildBuildingsTab(result);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Shoreline / Fish / Modifications / Wildlife tabs (all from the precompute)
// ---------------------------------------------------------------------------

const FISH_CODE_NAMES: Record<string, string> = {
  Ck: 'Chinook Salmon', Chum: 'Chum Salmon', Pk: 'Pink Salmon', Herr: 'Pacific Herring',
  Lance: 'Pacific Sand Lance', Smelt: 'Surf Smelt', Hex: 'Lingcod & Greenling',
};

function renderShorelineTab(popupId: string, veg: NearshoreVegetationResult) {
  const el = document.getElementById(`${popupId}-shoreline`);
  if (!el) return;
  el.innerHTML = (veg.shoreform ? buildShoreformCard(veg.shoreform) : '') + buildNearshoreVegetationHtml(veg, 'veg');
}

function renderFishTab(popupId: string, veg: NearshoreVegetationResult) {
  const el = document.getElementById(`${popupId}-fish`);
  if (!el) return;
  let scoresHtml: string;
  if (veg.fish && Object.keys(veg.fish.scores).length > 0) {
    const species = Object.entries(veg.fish.scores)
      .map(([code, v]) => ({ species: FISH_CODE_NAMES[code] ?? code, hrmValue: v.hrm, lrmValue: v.lrm }))
      .sort((a, b) => b.hrmValue - a.hrmValue);
    scoresHtml = buildFishCard({ species, shorelineDescription: veg.fish.segment }, veg.modDistances.fishFt, veg.fish.distFt);
  } else {
    scoresHtml = `<div style="${CARD}">${sectionHeading('Fish Utilization')}<p style="${BODY};color:${COLOR.mid};">No surveyed shoreline segment lies within ${veg.modDistances.fishFt} ft of this parcel, so there are no fish use scores to show. Shoreline segments are scored countywide; inland parcels have none.</p></div>`;
  }
  el.innerHTML = scoresHtml + buildNearshoreVegetationHtml(veg, 'spawn');
}

const SITE_VISIT_URL = 'https://sanjuans.org/our-work/landowner-resources/#SiteVisit';
const ARMOR_WEBINAR_URL = 'https://www.youtube.com/watch?v=Ts8aC0REZJA';

function renderModsTab(popupId: string, veg: NearshoreVegetationResult) {
  const el = document.getElementById(`${popupId}-mods`);
  if (!el) return;
  const m = veg.mods ?? {};
  const d = veg.modDistances;
  const MATERIAL: Record<string, string> = { W: 'wood', C: 'concrete', R: 'rock', S: 'steel', P: 'plastic', M: 'metal', F: 'fiberglass', O: 'other' };
  const CONDITION: Record<string, string> = { G: 'good', F: 'fair', P: 'poor', E: 'excellent' };
  const BUOY: Record<string, string> = { B: 'mooring buoy', F: 'float', R: 'raft' };
  const chip = (t: string, tone = '') => `<span class="ssx-chip${tone ? ` ssx-chip-${tone}` : ''}">${esc(t)}</span>`;

  const row = (present: boolean, title: string, detail: string, within: string) => `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;margin-bottom:8px;border-radius:8px;background:${present ? '#FDE9C8' : '#FBF7EF'};border:1px solid ${present ? '#F3CF98' : COLOR.border};">
      <span style="margin-top:6px;display:inline-block;width:9px;height:9px;border-radius:50%;background:${present ? '#C2410C' : COLOR.border};flex-shrink:0;"></span>
      <div style="min-width:0;flex:1;">
        <div style="font-size:15px;font-weight:700;color:${present ? '#6E3D03' : COLOR.mid};">${esc(title)}<span style="font-weight:500;font-size:13px;color:${COLOR.mid};margin-left:8px;">within ${esc(within)}</span></div>
        ${detail ? `<div style="font-size:14px;color:${COLOR.dark};margin-top:3px;line-height:1.45;">${detail}</div>` : ''}
      </div>
    </div>`;

  const ft = (n: number) => `${n.toLocaleString('en-US')} ft`;
  const rows: string[] = [];
  const a = m.armor;
  rows.push(row(!!a, 'Shoreline armor', a
    ? `About ${ft(a.lengthFt)} of bulkhead, riprap, or other hard armor along this parcel (${a.n} mapped ${a.n === 1 ? 'segment' : 'segments'}, nearest ${ft(a.distFt)}).`
    : 'No mapped armor along the parcel line.', `${d.armorFt} ft of the parcel line`));
  const docks = m.docks ?? [];
  rows.push(row(docks.length > 0, docks.length === 1 ? 'Dock' : `Docks (${docks.length})`, docks.length
    ? docks.map(k => {
        const bits = [MATERIAL[k.material.toUpperCase()] ? `${MATERIAL[k.material.toUpperCase()]} deck` : '', MATERIAL[k.floatMaterial.toUpperCase()] ? `${MATERIAL[k.floatMaterial.toUpperCase()]} float` : '', CONDITION[k.condition.toUpperCase()] ? `condition ${CONDITION[k.condition.toUpperCase()]}` : ''].filter(Boolean).join(', ');
        return `<div style="margin:2px 0;">${ft(k.distFt)} away${bits ? ` &mdash; ${esc(bits)}` : ''} ${k.creosote ? chip('creosote', 'warn') : ''}${k.grating ? chip('grated', 'on') : ''}</div>`;
      }).join('')
    : 'No mapped dock nearby.', `${d.structureFt} ft`));
  const simple = (key: 'groins' | 'ramps' | 'railways', title: string, noun: string) => {
    const v = m[key];
    rows.push(row(!!v, title, v ? `${v.n} mapped ${v.n === 1 ? noun : noun + 's'}, nearest ${ft(v.distFt)}.` : `No mapped ${noun} nearby.`, `${d.structureFt} ft`));
  };
  simple('groins', 'Groins', 'groin');
  simple('ramps', 'Improved boat ramps', 'ramp');
  simple('railways', 'Marine railways', 'railway');
  const pl = m.pilings;
  rows.push(row(!!pl, 'Pilings', pl ? `${pl.count || pl.n} ${pl.count === 1 ? 'piling' : 'pilings'} not tied to a dock, nearest ${ft(pl.distFt)}. ${pl.creosote ? chip('creosote', 'warn') : ''}` : 'No mapped stand-alone pilings nearby.', `${d.structureFt} ft`));
  const b = m.buoys;
  rows.push(row(!!b, 'Mooring buoys & floats', b
    ? `${b.n} mapped (${Object.entries(b.types).map(([t, n]) => `${n} ${BUOY[t] ?? 'moorage'}${n === 1 ? '' : 's'}`).join(', ')}), nearest ${ft(b.distFt)}.`
    : 'No mapped moorage nearby.', `${d.buoyFt} ft`));

  const any = !!(a || docks.length || m.groins || m.ramps || m.railways || pl || b);
  const cta = any
    ? `<div class="ssx-block ssx-act" style="margin:0 0 12px;"><div class="ssx-k">Friends can help</div>Friends of the San Juans offers free site visits and technical assistance to remove failing armor, soften banks, and upgrade docks, floats, and moorings to shore-friendly designs.<div class="ssx-btn-row"><a class="ssx-btn-sun" href="${SITE_VISIT_URL}" target="_blank" rel="noopener noreferrer">Sign up for a site visit</a> <a class="ssx-btn" href="${ARMOR_WEBINAR_URL}" target="_blank" rel="noopener noreferrer" style="margin-left:6px;">Armor research webinar ↗</a></div></div>`
    : `<div class="ssx-block ssx-act" style="margin:0 0 12px;"><div class="ssx-k">Keeping it that way</div>Planning a dock, mooring, or bank work? Friends offers free site visits to help design it around the habitat.<div class="ssx-btn-row"><a class="ssx-btn-sun" href="${SITE_VISIT_URL}" target="_blank" rel="noopener noreferrer">Sign up for a site visit</a></div></div>`;

  el.innerHTML = `
    <div style="${CARD}">
      ${sectionHeading('Shoreline Modifications')}
      <p style="${BODY};margin-bottom:12px;color:${COLOR.mid};">Human-made structures from Friends of the San Juans field surveys (2009, updated 2019): armor within ${d.armorFt} ft of the parcel line; docks, groins, ramps, railways, and pilings within ${d.structureFt} ft; mooring buoys and floats within ${d.buoyFt} ft.</p>
      ${rows.join('')}
    </div>
    ${cta}`;
}

function renderWhaleLink(popupId: string, lat: number, lng: number, name: string) {
  const el = document.getElementById(`${popupId}-whales`);
  if (!el) return;
  const url = `https://earthatlas.org/whales?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}&name=${encodeURIComponent(name)}&z=12`;
  el.innerHTML = `
    <div class="ssx-block ssx-story" style="margin:0 0 12px;">
      <div class="ssx-k">Whales &amp; marine mammals</div>
      Recent orca, humpback, porpoise, and seal sightings around this shoreline are mapped on EarthAtlas, centered on this parcel.
      <div class="ssx-btn-row"><a class="ssx-btn-sun" href="${url}" target="_blank" rel="noopener noreferrer">See sightings near here ↗</a></div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Bird observations (eBird API)
// ---------------------------------------------------------------------------

const BIRD_RADIUS_OPTIONS = [
  { miles: 1, km: 1.609 },
  { miles: 5, km: 8.047 },
  { miles: 10, km: 16.093 },
  { miles: 20, km: 32.187 },
];
const DEFAULT_BIRD_RADIUS_MILES = 5;

/**
 * If the forest-loss raster layer is currently visible, ask the Hansen
 * Cloud Function for the loss-patch info at the click point and inject
 * a small line into the Summary tab. No-op when the layer is off.
 */
function runForestLossQuery(
  lat: number,
  lng: number,
  popupId: string,
  allLayers: LayerState[],
) {
  const layer = allLayers.find(l => l.config.id === 'forest-loss');
  if (!layer?.visible) return;
  const endpoint = layer.config.apiEndpoint;
  if (!endpoint) return;

  const inject = (html: string) => {
    const el = document.getElementById(`${popupId}-forest-loss`);
    if (el) el.innerHTML = html;
  };

  inject(`<div style="${CARD}"><p style="font-size:13px;color:${COLOR.light};font-style:italic;">Looking up forest loss…</p></div>`);

  fetch(`${endpoint}?lat=${lat}&lng=${lng}`)
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{ year: number | null; acres: number; truncated?: boolean }>;
    })
    .then(data => {
      if (!data.year) {
        inject(
          `<div style="${CARD}"><p style="font-size:13px;color:${COLOR.mid};">No forest loss recorded at this point.</p></div>`,
        );
        return;
      }
      const acresStr = data.acres >= 0.01
        ? `${data.acres.toFixed(2)} acre${Math.abs(data.acres - 1) < 0.005 ? '' : 's'}`
        : '&lt; 0.01 acres';
      const truncatedNote = data.truncated
        ? ` <span style="color:${COLOR.mid};">(very large patch &mdash; area underestimated)</span>`
        : '';
      inject(
        `<div style="${CARD}">
           <p style="font-size:13px;color:${COLOR.dark};margin:0;">
             <strong style="color:${COLOR.teal};">Forest loss</strong> &mdash; ${acresStr} lost in ${data.year} at this point${truncatedNote}
           </p>
         </div>`,
      );
    })
    .catch(err => {
      console.error('Forest loss lookup failed:', err);
      inject(
        `<div style="${CARD}"><p style="font-size:13px;color:#B91C1C;margin:0;">Could not load forest-loss data.</p></div>`,
      );
    });
}

/**
 * If the opera-dist-alert raster layer is currently visible, ask the
 * Cloud Function for the disturbance-alert info at the click point and
 * inject a small line into the Summary tab. No-op when the layer is off.
 */
function runDistAlertQuery(
  lat: number,
  lng: number,
  popupId: string,
  allLayers: LayerState[],
) {
  const layer = allLayers.find(l => l.config.id === 'opera-dist-alert');
  if (!layer?.visible) return;
  const endpoint = layer.config.apiEndpoint;
  if (!endpoint) return;

  const inject = (html: string) => {
    const el = document.getElementById(`${popupId}-dist-alert`);
    if (el) el.innerHTML = html;
  };

  inject(`<div style="${CARD}"><p style="font-size:13px;color:${COLOR.light};font-style:italic;">Looking up disturbance alert…</p></div>`);

  fetch(`${endpoint}?lat=${lat}&lng=${lng}`)
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{
        date: string | null;
        statusLabel: string | null;
        severity: number | null;
        acres?: number;
        truncated?: boolean;
      }>;
    })
    .then(data => {
      if (!data.date) {
        inject(
          `<div style="${CARD}"><p style="font-size:13px;color:${COLOR.mid};">No vegetation disturbance recorded at this point.</p></div>`,
        );
        return;
      }
      const prettyDate = new Date(data.date).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      const severityStr = data.severity != null
        ? ` (${Math.round(data.severity)}% vegetation loss)`
        : '';
      const acresStr = data.acres != null && data.acres >= 0.01
        ? `${data.acres.toFixed(2)} acre${Math.abs(data.acres - 1) < 0.005 ? '' : 's'}`
        : '&lt; 0.01 acres';
      const truncatedNote = data.truncated
        ? ` <span style="color:${COLOR.mid};">(very large patch &mdash; area underestimated)</span>`
        : '';
      inject(
        `<div style="${CARD}">
           <p style="font-size:13px;color:${COLOR.dark};margin:0;">
             <strong style="color:${COLOR.teal};">Disturbance alert</strong> &mdash; ${data.statusLabel ?? 'detected'} on ${prettyDate}${severityStr}
           </p>
           <p style="font-size:12px;color:${COLOR.mid};margin:4px 0 0;">${acresStr} in this connected patch${truncatedNote}</p>
         </div>`,
      );
    })
    .catch(err => {
      console.error('DIST-ALERT lookup failed:', err);
      inject(
        `<div style="${CARD}"><p style="font-size:13px;color:#B91C1C;margin:0;">Could not load disturbance-alert data.</p></div>`,
      );
    });
}

function runBirdQuery(lat: number, lng: number, popupId: string) {
  const el = document.getElementById(`${popupId}-birds`);
  if (!el) {
    requestAnimationFrame(() => runBirdQuery(lat, lng, popupId));
    return;
  }

  const defaultOpt = BIRD_RADIUS_OPTIONS.find(o => o.miles === DEFAULT_BIRD_RADIUS_MILES)!;
  fetchNearbyBirdSummary(lat, lng, 30, defaultOpt.km).then(results => {
    renderBirdsTab(popupId, results, 30, DEFAULT_BIRD_RADIUS_MILES, lat, lng);
  }).catch(() => {
    const birdsEl = document.getElementById(`${popupId}-birds`);
    if (birdsEl) {
      birdsEl.innerHTML = `<div style="${CARD}"><p style="${BODY};color:${COLOR.mid};">Unable to load bird observations. Check your connection and try again.</p></div>`;
    }
  });
}

function renderBirdsTab(
  popupId: string,
  results: BirdSpeciesSummary[],
  back: number,
  radiusMiles: number,
  lat: number,
  lng: number,
) {
  const el = document.getElementById(`${popupId}-birds`);
  if (!el) return;

  const periodSelectId = `${popupId}-bird-period`;
  const radiusSelectId = `${popupId}-bird-radius`;

  const periodOptions = [
    { value: 1, label: 'Today' },
    { value: 7, label: 'Past Week' },
    { value: 30, label: 'Past 30 Days' },
  ];

  const selectStyle = `
    font-family:${FONT}; font-size:13px; padding:3px 6px;
    border:1px solid ${COLOR.border}; border-radius:6px;
    background:${COLOR.bg}; color:${COLOR.dark}; cursor:pointer;
  `;

  const periodSelectHtml = `
    <select id="${periodSelectId}" style="${selectStyle}">
      ${periodOptions.map(o =>
        `<option value="${o.value}" ${o.value === back ? 'selected' : ''}>${esc(o.label)}</option>`
      ).join('')}
    </select>
  `;

  const radiusSelectHtml = `
    <select id="${radiusSelectId}" style="${selectStyle}">
      ${BIRD_RADIUS_OPTIONS.map(o =>
        `<option value="${o.miles}" ${o.miles === radiusMiles ? 'selected' : ''}>${o.miles} mi</option>`
      ).join('')}
    </select>
  `;

  const header = `
    <div style="margin-bottom:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <div style="font-size:16px;font-weight:700;color:${COLOR.dark};">${results.length} species</div>
        <div style="display:flex;gap:6px;">${periodSelectHtml}${radiusSelectHtml}</div>
      </div>
      <div style="font-size:13px;color:${COLOR.mid};">Recent birds reported within a ${radiusMiles} mile radius</div>
    </div>
  `;

  let listHtml: string;
  if (results.length === 0) {
    listHtml = `<div style="${CARD}"><p style="${BODY};color:${COLOR.mid};">No bird observations recorded in this area for the selected period.</p></div>`;
  } else {
    const rows = results.map(sp => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;border-bottom:1px solid ${COLOR.border};">
        <div style="min-width:0;">
          <div style="font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"><a href="https://ebird.org/species/${encodeURIComponent(sp.speciesCode)}" target="_blank" style="color:${COLOR.dark};text-decoration:none;" onmouseover="this.style.color='${COLOR.teal}'" onmouseout="this.style.color='${COLOR.dark}'">${esc(sp.comName)}</a></div>
          <div style="font-size:13px;color:${COLOR.mid};font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(sp.sciName)}</div>
        </div>
        <div style="
          min-width:36px; text-align:center; padding:3px 8px;
          background:rgba(13,79,79,0.1); color:${COLOR.teal};
          font-size:14px; font-weight:700; border-radius:12px; margin-left:12px; shrink:0;
        ">${sp.count}</div>
      </div>
    `).join('');
    listHtml = `<div style="${CARD}padding:0;overflow:hidden;">${rows}</div>`;
  }

  const attribution = `
    <div style="font-size:12px;color:${COLOR.light};text-align:center;margin-top:8px;">
      Data from <a href="https://ebird.org" target="_blank" style="color:${COLOR.teal};">eBird</a> (Cornell Lab of Ornithology)
    </div>
  `;

  el.innerHTML = header + listHtml + attribution;

  // Re-fetch helper
  function refetch() {
    const periodEl = document.getElementById(periodSelectId) as HTMLSelectElement | null;
    const radiusEl = document.getElementById(radiusSelectId) as HTMLSelectElement | null;
    const newBack = Number(periodEl?.value ?? back);
    const newMiles = Number(radiusEl?.value ?? radiusMiles);
    const newKm = BIRD_RADIUS_OPTIONS.find(o => o.miles === newMiles)?.km ?? 8.047;
    if (el) el.innerHTML = `<div style="${CARD}"><p style="${BODY};color:${COLOR.light};font-style:italic;">Loading bird observations...</p></div>`;
    fetchNearbyBirdSummary(lat, lng, newBack, newKm).then(newResults => {
      renderBirdsTab(popupId, newResults, newBack, newMiles, lat, lng);
    }).catch(() => {
      if (el) el.innerHTML = `<div style="${CARD}"><p style="${BODY};color:${COLOR.mid};">Unable to load bird observations.</p></div>`;
    });
  }

  const periodSelect = document.getElementById(periodSelectId) as HTMLSelectElement | null;
  if (periodSelect) periodSelect.addEventListener('change', refetch);

  const radiusSelect = document.getElementById(radiusSelectId) as HTMLSelectElement | null;
  if (radiusSelect) radiusSelect.addEventListener('change', refetch);
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

  void accentColor; // tabs take their color from the frame CSS now
  const srcEl = popupEl.querySelector<HTMLElement>('.ssx-src');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab');
      buttons.forEach(b => b.classList.toggle('on', b === btn));
      panels.forEach(p => {
        p.hidden = p.getAttribute('data-panel') !== target;
      });
      // Footer credit follows the tab: each one draws on different datasets
      const src = btn.getAttribute('data-source');
      if (srcEl && src) srcEl.textContent = `Source: ${src}`;
    });
  });
}

// ---------------------------------------------------------------------------
// Property snapshot mini-map
// ---------------------------------------------------------------------------

function renderPropertySnapshot(
  popupId: string,
  parcelFeature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
  buildings: GeoJSON.Feature[],
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

  // Create mini-map matching the main map's base style
  const mapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID;
  const miniMap = new google.maps.Map(container, {
    center: bounds.getCenter(),
    mapTypeId: google.maps.MapTypeId.HYBRID,
    ...(mapId ? { mapId } : {}),
    disableDefaultUI: true,
    gestureHandling: 'none',
    clickableIcons: false,
    keyboardShortcuts: false,
  });

  // Fit to parcel with padding
  miniMap.fitBounds(bounds, 20);

  // Add parcel boundary with the same highlight style as the main map selection
  const parcelData = new google.maps.Data({ map: miniMap });
  parcelData.addGeoJson({ type: 'FeatureCollection', features: [parcelFeature] });
  parcelData.setStyle({
    fillColor: '#F97316',
    fillOpacity: 0.25,
    strokeColor: '#F97316',
    strokeWeight: 4,
  });

  // Add building footprints within the parcel bounds
  if (buildings.length > 0) {
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const parcelBbox: [number, number, number, number] = [sw.lng(), sw.lat(), ne.lng(), ne.lat()];

    const nearbyBuildings: GeoJSON.Feature[] = [];
    for (const feat of buildings) {
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
  _label: string,
  layer: LayerState,
  fields: { label: string; value: string }[],
  addressRowId: string,
  popupId: string,
  props: Record<string, unknown> = {},
): string {
  const accentColor = layer.config.style.strokeColor || layer.config.style.fillColor || '#0297BA';

  // Each tab credits its own sources, source first, then what it supplied.
  // The frame footer follows the active tab.
  const TAB_SOURCES: Record<string, string> = {
    summary: 'San Juan County GIS (assessor parcels); Friends of the San Juans (shore type, kelp, eelgrass)',
    shoreline: 'Friends of the San Juans (shoreform mapping with Coastal Geologic Services, kelp, eelgrass); Washington DNR (kelp, eelgrass); Friday Harbor Labs (eelgrass)',
    fish: 'Beamer & Fresh 2012, Skagit River System Cooperative (fish use scores); Friends of the San Juans (forage fish spawning beaches); WDFW (forage fish records, herring spawning grounds)',
    wildlife: 'eBird, Cornell Lab of Ornithology (birds); EarthAtlas (marine mammal sightings)',
    mods: 'Friends of the San Juans (shoreline inventory 2009, armor change survey 2019)',
    vegetation: 'USDA NAIP imagery via Google Earth Engine (greenery); Hansen/UMD/Google/USGS/NASA (forest loss); NASA OPERA (disturbance)',
    property: 'San Juan County GIS (assessor parcels, building footprints)',
  };
  const tabBtn = (name: string, dataTab: string, active: boolean) =>
    `<button type="button" class="ssx-tab${active ? ' on' : ''}" data-tab="${dataTab}" data-source="${esc(TAB_SOURCES[dataTab] ?? '')}">${esc(name)}</button>`;

  const propertyContent = buildPropertyTab(fields, addressRowId, popupId);
  const panelStyle = 'min-height:520px;max-height:520px;overflow-y:auto;';
  const loading = (text: string) => `<div style="${CARD}"><p style="${BODY};color:${COLOR.light};font-style:italic;">${text}</p></div>`;

  // Key facts from the assessor record; waterfront only when present.
  // Appraised value deliberately stays out of the header (Friends doesn't want it featured).
  const acres = Number(props.Acres || props.Legal_Acre) || 0;
  const wf = Number(props.WF_LGTH) || 0;
  const stats: PopupStat[] = [];
  if (acres > 0) stats.push({ value: fmtAcresValue(acres), unit: 'ac', label: 'Parcel' });
  if (wf > 0) stats.push({ value: Math.round(wf).toLocaleString('en-US'), unit: 'ft', label: 'Waterfront' });

  const body = `
      <div class="ssx-tabs" id="${popupId}-tabs">
        ${tabBtn('Summary', 'summary', true)}
        ${tabBtn('Shoreline', 'shoreline', false)}
        ${tabBtn('Fish', 'fish', false)}
        ${tabBtn('Wildlife', 'wildlife', false)}
        ${tabBtn('Modifications', 'mods', false)}
        ${tabBtn('Vegetation', 'vegetation', false)}
        ${tabBtn('Property', 'property', false)}
      </div>

      <div class="ssx-panel" data-panel="summary" style="${panelStyle}">
        <div class="ssx-two" style="display:flex;gap:12px;margin-bottom:12px;align-items:stretch;">
          <div id="${popupId}-at-a-glance" style="flex:1;min-width:0;">
            <div style="${CARD};height:100%;box-sizing:border-box;margin-bottom:0;"><p style="font-size:13px;color:${COLOR.light};font-style:italic;">Loading overview...</p></div>
          </div>
          <div id="${popupId}-snapshot" class="ssx-minimap" style="width:200px;height:200px;min-width:200px;border-radius:8px;overflow:hidden;background:${COLOR.bg};display:flex;align-items:center;justify-content:center;">
            <span style="font-size:12px;color:${COLOR.light};font-style:italic;">Loading map...</span>
          </div>
        </div>
        <div id="${popupId}-summary-cards">${loading('Loading property data...')}</div>
      </div>
      <div class="ssx-panel" data-panel="shoreline" hidden style="${panelStyle}">
        <div id="${popupId}-shoreline">${loading('Checking nearshore habitat…')}</div>
      </div>
      <div class="ssx-panel" data-panel="fish" hidden style="${panelStyle}">
        <div id="${popupId}-fish">${loading('Checking fish use and spawning data…')}</div>
      </div>
      <div class="ssx-panel" data-panel="wildlife" hidden style="${panelStyle}">
        <div id="${popupId}-whales"></div>
        <div id="${popupId}-birds">${loading('Loading bird observations...')}</div>
      </div>
      <div class="ssx-panel" data-panel="mods" hidden style="${panelStyle}">
        <div id="${popupId}-mods">${loading('Checking shoreline modifications…')}</div>
      </div>
      <div class="ssx-panel" data-panel="vegetation" hidden style="${panelStyle}">
        <div id="${popupId}-greenery">${loading('Loading vegetation data…')}</div>
        <div id="${popupId}-forest-loss"></div>
        <div id="${popupId}-dist-alert"></div>
      </div>
      <div class="ssx-panel" data-panel="property" hidden style="${panelStyle}">
        ${propertyContent}
      </div>`;

  return buildPopupFrame({
    id: popupId,
    width: 600,
    accent: accentColor,
    layerName: layer.config.name,
    swatch: 'fill',
    swatchColor: layer.config.style.fillColor,
    title: 'Loading address...',
    titleId: `${popupId}-title`,
    subtitle: [String(props.PIN || '').trim() ? `PIN ${String(props.PIN).trim()}` : '', 'Property report'].filter(Boolean).join(' · '),
    stats,
    chipsId: `${popupId}-chips`,
    body,
    source: { credit: TAB_SOURCES.summary, url: layer.config.sourceUrl },
  });
}

// ---------------------------------------------------------------------------
// Property tab
// ---------------------------------------------------------------------------

function buildPropertyTab(fields: { label: string; value: string }[], addressRowId: string, popupId: string): string {
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
            <td style="color:${COLOR.dark};padding:5px 0;word-break:break-word;">${linkify(f.value)}</td>
          </tr>
        `).join('')}
      </table>
    </div>
    <div id="${popupId}-buildings">
      <div style="${CARD}"><p style="${BODY};color:${COLOR.light};font-style:italic;">Checking for buildings...</p></div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Summary tab
// ---------------------------------------------------------------------------

interface IslandProject {
  name: string;
  kind: string;
  island: string;
  date: string;
  link: string;
}

const ISLAND_NAMES = ['San Juan', 'Orcas', 'Lopez', 'Shaw', 'Blakely', 'Decatur', 'Stuart', 'Waldron', 'Sucia', 'Brown', 'Henry', 'Spieden', 'Jones', 'Patos', 'Matia', 'Obstruction', 'Crane', 'Center', 'Pearl', 'Johns', 'Sinclair', 'Cypress'];

/** Which island a parcel is on, from the assessor tax area ("ORCAS/CEMETERY" → "Orcas"). */
function islandOfParcel(props: Record<string, unknown>, addrEntries: AddressEntry[] | null): string {
  const cands = [String(props.Tax_Area ?? ''), String(addrEntries?.[0]?.PLACENAME ?? ''), String(addrEntries?.[0]?.MSAG ?? '')];
  for (const c of cands) {
    const u = c.toUpperCase();
    const hit = ISLAND_NAMES.find(n => u.startsWith(n.toUpperCase()) || u.includes(n.toUpperCase() + ' IS'));
    if (hit) return hit;
  }
  return '';
}

/** Friends' Projects on an island, newest first, from the loaded layer. */
function projectsOnIsland(island: string, allLayers: LayerState[]): IslandProject[] {
  if (!island) return [];
  const layer = allLayers.find(l => l.config.id === 'friends-projects');
  const feats = layer?.geojsonData?.features ?? [];
  const out: IslandProject[] = [];
  for (const f of feats) {
    const p = f.properties ?? {};
    const isl = String(p.ISLAND ?? '').trim().toLowerCase();
    if (!isl || !isl.startsWith(island.toLowerCase())) continue;
    out.push({ name: String(p.NAME ?? ''), kind: String(p.kind ?? ''), island, date: String(p.DATE ?? ''), link: String(p.LINK ?? '') });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

const PROJECT_KIND_COLORS: Record<string, string> = {
  'Restoration project': '#0297BA', 'Riparian project': '#3D6410', 'In/over-water structure project': '#8F6B2E', 'Restoration site': '#0D4F4F',
};

/** "Distance to the nearest Orcas Island shoreline:" (plain text; the heading escapes it). */
function shoreHeading(raw: string): string {
  const name = raw.replace(/\s+Is\.?$/i, ' Island').trim();
  return name ? `Distance to the nearest ${name} shoreline:` : 'Distance to the nearest shoreline:';
}

/**
 * Summary cards for a property that isn't on the shore: how far the water is
 * and which shoreline, tree cover, Friends' work on the same island, and what
 * upland stewardship means for the nearshore, with Friends' own articles.
 */
function buildInlandCards(
  props: Record<string, unknown>,
  veg: NearshoreVegetationResult,
  ndviStats: NdviStats | null,
  islandStats: IslandPercentile | null,
  islandProjects: IslandProject[],
): string[] {
  const cards: string[] = [];
  const island = islandProjects[0]?.island || '';

  // Distance to the water
  if (veg.shore) {
    const ft = veg.shore.distFt;
    const dist = ft >= 5280 ? `${(ft / 5280).toFixed(1)} mi` : `${ft.toLocaleString('en-US')} ft`;
    cards.push(`
      <div style="${CARD}">
        ${sectionHeading(shoreHeading(veg.shore.name))}
        <div style="${BIG_NUM}">${esc(dist)}</div>
        <p style="${BODY};margin-top:10px;">Rain that falls here drains toward that shoreline. Forest cover, streamside vegetation, and how runoff leaves the property all shape the beach and the nearshore water below it.</p>
      </div>`);
  }

  // Tree cover (also on the Vegetation tab)
  if (ndviStats) {
    // Drawn from Friends' shoreline vegetation and restoration pages: roots and canopy
    // filter runoff before it reaches the water; overhanging vegetation keeps forage
    // fish eggs cool and moist on the beach.
    const beachNote = `<p style="${BODY};margin-top:8px;">Trees and native plants also do quiet work for the beach below. Roots and canopy slow rain and filter it before it reaches streams and the shore, keeping sediment and pollutants out of nearshore water, and vegetation that overhangs a beach shades the sand and gravel where forage fish eggs need to stay cool and moist. <a href="https://sanjuans.org/our-work/shoreline-ecosystems/shoreline-vegetation-resources-for-san-juan-county/" target="_blank" rel="noopener noreferrer" style="color:${COLOR.teal};font-weight:600;text-decoration:none;">Friends&#39; vegetation resources &#8599;</a></p>`;
    cards.push(buildGreeneryCard(ndviStats, false, islandStats, beachNote));
  }

  // Friends' Projects on this island
  if (islandProjects.length) {
    const rows = islandProjects.map(p => `
      <div style="display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-top:1px solid ${COLOR.border};">
        <span style="margin-top:6px;width:10px;height:10px;border-radius:50%;background:${PROJECT_KIND_COLORS[p.kind] ?? COLOR.teal};flex-shrink:0;"></span>
        <div style="min-width:0;flex:1;">
          <div style="font-size:15px;font-weight:600;color:${COLOR.dark};">${p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener noreferrer" style="color:${COLOR.dark};text-decoration:none;">${esc(p.name)} &#8599;</a>` : esc(p.name)}</div>
          <div style="font-size:13px;color:${COLOR.mid};">${esc(p.kind)}${p.date ? ` · ${esc(p.date)}` : ''}</div>
        </div>
      </div>`).join('');
    cards.push(`
      <div style="${CARD}">
        ${sectionHeading(`Friends' work on ${esc(island)} Island`)}
        <p style="${BODY};margin-bottom:6px;">${islandProjects.length === 1 ? 'One Friends of the San Juans project' : `${islandProjects.length} Friends of the San Juans projects`} on ${esc(island)}, most recent first.</p>
        ${rows}
      </div>`);
  }

  // Upland stewardship + Friends' articles
  const idx = getFriendsContentSync();
  const articles = articlesForFeature(idx, 'upland-property', { ISLAND: island }, 3).slice().sort((a, b) => b.date.localeCompare(a.date));
  cards.push(`
    <div style="${CARD}">
      ${sectionHeading('Upland stewardship')}
      <div class="ssx-block ssx-act" style="margin:0 0 ${articles.length ? 12 : 0}px;">
        <div class="ssx-k">What you can do here</div>
        Keep native trees and shrubs, especially along streams and wet areas; direct roof and driveway runoff into the ground rather than a ditch; and skip fertilizer and pesticides near water. Friends offers free advice for upland and shoreline landowners alike.
        <div class="ssx-btn-row"><a class="ssx-btn-sun" href="https://sanjuans.org/our-work/landowner-resources/" target="_blank" rel="noopener noreferrer">Landowner resources</a></div>
      </div>
      ${articles.length ? fromFriendsHtml(articles).replace('class="ssx-from"', 'class="ssx-from" style="margin:0"') : ''}
    </div>`);
  void props;
  return cards;
}

function renderSummary(
  popupId: string,
  props: Record<string, unknown>,
  buildingResult: BuildingQueryResult | null,
  shorelineResult: ShorelineQueryResult | null,
  vegResult: NearshoreVegetationResult | null,
  ndviStats: NdviStats | null,
  islandStats: IslandPercentile | null,
  addrEntries: AddressEntry[] | null,
  islandProjects: IslandProject[] = [],
) {
  // At a Glance goes in the left column next to the snapshot
  const glanceEl = document.getElementById(`${popupId}-at-a-glance`);
  if (glanceEl) {
    glanceEl.innerHTML = buildAtAGlanceCard(props, buildingResult, addrEntries);
  }

  // Remaining cards go below the hero row
  const cardsEl = document.getElementById(`${popupId}-summary-cards`);
  if (!cardsEl) return;

  const cards: string[] = [];

  void shorelineResult; // fish scores now live in the Fish tab, from the precompute

  const shore = vegResult ? isShorelineParcel(props, vegResult) : true;
  if (vegResult && !shore) {
    hideShoreTabs(popupId);
    cards.push(...buildInlandCards(props, vegResult, ndviStats, islandStats, islandProjects));
  }

  // --- Shoreline Description: Friends geomorphic shoreform first, Beamer geo-unit as fallback ---
  if (shore && vegResult?.shoreform) {
    cards.push(buildShoreformCard(vegResult.shoreform));
  } else if (shore && vegResult?.fish?.segment?.geoUnit) {
    cards.push(buildShorelineDescriptionCard(vegResult.fish.segment));
  }

  // --- Nearshore Ecology (Eelgrass & Kelp) ---
  if (vegResult && shore) {
    cards.push(buildNearshoreEcologyCard(vegResult));
    renderLivingShorelineChips(popupId, vegResult);
  }

  cardsEl.innerHTML = cards.join('');

  // --- Greenery & Tree Cover lives in the Vegetation tab ---
  const greenEl = document.getElementById(`${popupId}-greenery`);
  if (greenEl && ndviStats) {
    greenEl.innerHTML = buildGreeneryCard(ndviStats, Number(props.WF_LGTH) > 0, islandStats);
  } else if (greenEl && ndviStats === null && vegResult) {
    greenEl.innerHTML = `<div style="${CARD}">${sectionHeading('Greenery & Tree Cover')}<p style="${BODY};color:${COLOR.mid};">No vegetation index is available for this parcel yet.</p></div>`;
  }
}

/**
 * Shoreline property? True when the assessor records waterfront or tidelands,
 * or the precompute found a shoreform, a surveyed shoreline segment, or any
 * nearshore habitat within its search distances (500 ft for kelp/eelgrass).
 * Inland properties hide every shore-specific card and tab.
 */
function isShorelineParcel(props: Record<string, unknown>, veg: NearshoreVegetationResult | null): boolean {
  if ((Number(props.WF_LGTH) || 0) > 0 || (Number(props.TidelandFt) || 0) > 0) return true;
  if (!veg) return false;
  return !!(veg.shoreform || veg.fish || veg.bullKelp.present || veg.eelgrass.present || veg.forage.present || veg.herring.present || veg.mods);
}

/** Hide the shore-specific tabs for an inland property (Summary keeps a note). */
function hideShoreTabs(popupId: string) {
  const popupEl = document.getElementById(popupId);
  if (!popupEl) return;
  for (const t of ['shoreline', 'fish', 'mods']) {
    popupEl.querySelector<HTMLElement>(`[data-tab="${t}"]`)?.remove();
    popupEl.querySelector<HTMLElement>(`[data-panel="${t}"]`)?.remove();
  }
  const chips = document.getElementById(`${popupId}-chips`);
  if (chips) chips.hidden = true;
}

/** Header chips: what living shoreline is near this parcel, lit when present. */
function renderLivingShorelineChips(popupId: string, veg: NearshoreVegetationResult) {
  const el = document.getElementById(`${popupId}-chips`);
  if (!el) return;
  const chip = (present: boolean, label: string) =>
    `<span class="ssx-chip${present ? ' ssx-chip-on' : ''}">${present ? '' : 'No '}${label}</span>`;
  el.innerHTML = [
    chip(veg.bullKelp.present, veg.bullKelp.present && veg.bullKelp.distFt != null ? `Bull kelp ${veg.bullKelp.distFt} ft` : 'bull kelp'),
    chip(veg.eelgrass.present, veg.eelgrass.present && veg.eelgrass.distFt != null ? `Eelgrass ${veg.eelgrass.distFt} ft` : 'eelgrass'),
    chip(veg.forage.present, veg.forage.present ? 'Forage fish beach' : 'forage fish beach'),
    chip(veg.herring.present, veg.herring.present ? 'Herring ground' : 'herring ground'),
  ].join('');
  el.hidden = false;
}

/**
 * Every non-parcel feature renders through the shared frame. A layer's
 * POPUP_SPECS entry decides the title, facts, chips, story, and action;
 * everything else comes from the layer config and the feature's fields.
 */
/** "From Friends" block: related articles from sanjuans.org, with the best one's summary. */
function fromFriendsHtml(articles: ContentItem[], skipSummaryId?: string): string {
  if (!articles.length) return '';
  const rows = articles.map((a, i) => `
    <a class="ssx-art" href="${escHtml(a.url)}" target="_blank" rel="noopener noreferrer">
      ${a.image ? `<img class="ssx-art-img" src="${escHtml(a.image.url)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      <span class="ssx-art-body">
        <span class="ssx-art-title">${escHtml(a.title)}</span>
        <span class="ssx-art-meta">${escHtml(articleDate(a.date))}</span>
        ${i === 0 && a.summary && a.id !== skipSummaryId ? `<span class="ssx-art-sum">${escHtml(a.summary)}</span>` : ''}
      </span>
    </a>`).join('');
  return `<div class="ssx-from"><div class="ssx-k">From Friends of the San Juans</div>${rows}</div>`;
}

export function buildFeaturePopupHtml(
  layer: LayerState,
  props: Record<string, unknown>,
  fields: { label: string; value: string }[],
  label: string,
): string {
  const { config } = layer;
  const spec = POPUP_SPECS[config.id];
  const accent = config.style.strokeColor || config.style.fillColor || '#0297BA';
  const swatch = config.markerIcon ? 'point' : (config.style.fillOpacity ?? 0) > 0.05 ? 'fill' : 'line';

  const title = spec?.title?.(props) || (label && label !== 'Feature' ? label : fallbackTitle(config, props));
  const subtitle = spec?.subtitle?.(props);
  const island = String(props.ISLAND ?? props.Island ?? props.island ?? '');

  // Friends' website content: the feature's own article (projects) or the
  // best articles for this layer supply photos and a "From Friends" list.
  const idx = getFriendsContentSync();
  const own = config.id === 'friends-projects'
    ? (articleForUrl(idx, typeof props.LINK === 'string' ? props.LINK : undefined) ?? articleForProject(idx, String(props.NAME ?? ''), island))
    : null;
  const related = articlesForFeature(idx, config.id, props, 3).filter(a => a.id !== own?.id);
  // Pick by relevance, then list newest first
  const articles = (own ? [own, ...related].slice(0, 3) : related).slice().sort((a, b) => b.date.localeCompare(a.date));

  const photos: PopupPhoto[] = spec?.photos?.(props) ?? [];
  const shortCaption = (t: string) => {
    const c = t.trim();
    return c.length > 0 && c.length <= 70 ? c : '';
  };
  if (!photos.length) {
    if (own) {
      // A project's own article: its photos are the project (before / after)
      photos.push(...own.images.slice(0, 4).map(im => ({ url: im.url, caption: shortCaption(im.caption), credit: 'Friends of the San Juans' })));
    } else {
      // Habitat / structure layers: the curated handout photo first, then only
      // Friends photos whose captions name the subject.
      if (LAYER_PHOTOS[config.id]) photos.push(LAYER_PHOTOS[config.id]);
      if (LAYER_PHOTOS_MORE[config.id]) photos.push(...LAYER_PHOTOS_MORE[config.id]);
      const subject = PHOTO_SUBJECTS[config.id];
      if (subject) {
        for (const im of photosForSubject(idx, subject, PHOTO_EXCLUDE, 2)) {
          photos.push({ url: im.url, caption: im.caption, credit: 'Friends of the San Juans' });
        }
      }
    }
  }
  if (!photos.length && LAYER_PHOTOS[config.id]) photos.push(LAYER_PHOTOS[config.id]);

  const story = spec?.story?.(props)
    ?? (own?.summary ? { kicker: 'Why it matters', html: escHtml(own.summary) } : undefined)
    ?? (config.standardMessage ? { kicker: 'Why it matters', html: escHtml(config.standardMessage) } : undefined);
  const link = spec?.link?.(props);
  const footerButtons = link ? [{ label: link.label, href: link.href }] : [];

  return buildPopupFrame({
    id: `feature-${Date.now()}`,
    accent,
    layerName: config.name,
    swatch,
    swatchColor: config.style.fillColor,
    title,
    subtitle,
    photos,
    stats: spec?.stats?.(props),
    chips: spec?.chips?.(props),
    story,
    action: spec?.action,
    body: fromFriendsHtml(articles, own && !spec?.story?.(props) ? own.id : undefined),
    fields: spec?.noDetails ? [] : fields,
    source: { credit: config.sourceCredit, url: config.sourceUrl },
    footerButtons,
  });
}

/** Open a feature popup; if the Friends content index hasn't arrived yet, refresh the content once it does. */
function openFeaturePopup(
  layer: LayerState,
  props: Record<string, unknown>,
  fields: { label: string; value: string }[],
  label: string,
  latLng: google.maps.LatLng,
  map: google.maps.Map,
  infoWindowRef: React.RefObject<PopupHost | null>,
) {
  const iw = infoWindowRef.current;
  if (!iw) return;
  iw.setContent(buildFeaturePopupHtml(layer, props, fields, label));
  iw.setPosition(latLng);
  iw.open(map);
  if (!getFriendsContentSync()) {
    preloadFriendsContent().then(idx => {
      if (idx && infoWindowRef.current === iw && iw.isOpen) iw.setContent(buildFeaturePopupHtml(layer, props, fields, label));
    });
  }
}

function buildAtAGlanceCard(
  props: Record<string, unknown>,
  buildingResult: BuildingQueryResult | null,
  addrEntries: AddressEntry[] | null,
): string {
  const acres = fmtAcres(props.Acres || props.Legal_Acre);
  const taxArea = String(props.Tax_Area || '').trim();
  const wfLength = Number(props.WF_LGTH) || 0;
  const buildings = buildingResult?.count ?? 0;
  const totalSqFt = buildingResult?.totalSqFt ?? 0;

  // Compact stat rows (label: value)
  const compactStat = (value: string, label: string) =>
    `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:3px 0;">
      <span style="font-size:14px;color:${COLOR.mid};font-weight:600;">${esc(label)}</span>
      <span style="font-size:16px;font-weight:700;color:${COLOR.teal};">${esc(value)}</span>
    </div>`;

  const statRows: string[] = [];
  statRows.push(compactStat(acres, 'Acres'));
  if (buildings > 0) statRows.push(compactStat(String(buildings), buildings === 1 ? 'Building' : 'Buildings'));
  if (totalSqFt > 0) statRows.push(compactStat(Math.round(totalSqFt).toLocaleString(), 'Sq Ft'));
  if (wfLength > 0) statRows.push(compactStat(Math.round(wfLength) + ' ft', 'Waterfront'));

  const statsBlock = `<div style="margin-bottom:8px;border-bottom:1px solid ${COLOR.border};padding-bottom:6px;">${statRows.join('')}</div>`;

  // Quick details
  const COMPACT_BODY = `font-size:15px;color:${COLOR.dark};line-height:1.45;margin:0;`;
  const compactPill = (text: string) => `<span style="color:${COLOR.teal};font-weight:700;font-size:15px;">${esc(text)}</span>`;

  const details: string[] = [];
  if (taxArea) details.push(`Located in ${compactPill(taxArea)}`);
  const description = String(props.Descriptio || '').trim();
  if (description) details.push(`classified as ${compactPill(description)}`);

  if (addrEntries && addrEntries.length > 0) {
    const bldgType = addrEntries[0].BLDGTYPE;
    if (bldgType) details.push(`${compactPill(bldgType)} use`);
  }

  // No dollar values in the Summary (sale price, assessed value): those stay on the Property tab.
  let detailText = details.length > 0 ? `<p style="${COMPACT_BODY}">${details.join(', ')}.</p>` : '';

  if (addrEntries && addrEntries.length > 0) {
    const primary = addrEntries[0];
    const placeName = primary.PLACENAME;
    const community = primary.MSAG;
    const addrParts: string[] = [];
    if (placeName) addrParts.push(compactPill(placeName));
    if (community) addrParts.push(esc(community));
    if (addrParts.length > 0) {
      detailText += `<p style="${COMPACT_BODY};margin-top:3px;">${addrParts.join(', ')}.</p>`;
    }

    if (addrEntries.length > 1) {
      const others = addrEntries.slice(1).filter(e => e.FULLADDR).map(e => e.FULLADDR!);
      if (others.length > 0) {
        const label = others.length === 1 ? '1 additional address' : `${others.length} additional addresses`;
        detailText += `<p style="${COMPACT_BODY};margin-top:3px;">${compactPill(label)} on this parcel.</p>`;
      }
    }
  }

  return `
    <div style="${CARD};height:100%;box-sizing:border-box;margin-bottom:0;">
      <div style="${HEADING};margin-bottom:6px;">At a Glance</div>
      ${statsBlock}
      ${detailText}
    </div>
  `;
}

const HML: Record<string, string> = { H: 'High', M: 'Medium', L: 'Low', None: 'None', Y: 'Yes', N: 'No', P: 'Potential' };
// San Juan County Shoreline Master Program environment designations
const SHORE_DESIG: Record<string, string> = { N: 'Natural', C: 'Conservancy', R: 'Rural', U: 'Urban', A: 'Aquatic' };

/** Friends of the San Juans geomorphic shoreform for the shoreline nearest this parcel. */
function buildShoreformCard(sf: NonNullable<NearshoreVegetationResult['shoreform']>): string {
  const type = SHOREFORM_TYPES[sf.code];
  const label = type?.label ?? sf.code ?? 'Unclassified';
  const color = type?.color ?? COLOR.teal;
  const description = type?.description ?? '';

  const chip = (k: string, v: string) => v
    ? `<span style="display:inline-flex;align-items:baseline;gap:4px;padding:3px 10px;background:#EFE9DD;border-radius:999px;font-size:13.5px;color:${COLOR.mid};font-weight:600;"><span>${k}</span><strong style="color:${COLOR.dark};">${esc(v)}</strong></span>`
    : '';
  const chips = [
    chip('Forage fish habitat', HML[sf.ffhab] ?? sf.ffhab),
    chip('Protection priority', HML[sf.protection] ?? sf.protection),
    chip('Restoration priority', HML[sf.restoration] ?? sf.restoration),
    chip('SMP designation', SHORE_DESIG[sf.shoreDesig] ?? sf.shoreDesig),
    sf.publicOwnership ? chip('Ownership', 'Some public') : '',
  ].filter(Boolean).join(' ');

  return `
    <div style="${CARD}">
      ${sectionHeading('Shoreline Type')}
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <span style="display:inline-block;width:26px;height:6px;border-radius:3px;background:${color};flex-shrink:0;"></span>
        <span style="font-size:17px;font-weight:700;color:${COLOR.dark};">${esc(label)}</span>
        ${sf.distFt > 0 ? `<span style="font-size:14px;color:${COLOR.mid};">${sf.distFt} ft from parcel line</span>` : ''}
      </div>
      ${description ? `<p style="${BODY};margin-bottom:10px;">${esc(description)}</p>` : ''}
      ${chips ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;">${chips}</div>` : ''}
      <p style="font-size:14px;color:${COLOR.mid};margin:8px 0 0;line-height:1.45;">
        Geomorphic shoreform mapping by Friends of the San Juans (Coastal Geologic Services, 2012). Coastal processes affect each shore form differently, resulting in different management concerns and priorities.
      </p>
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

const KELP_TEXT = `Bull (canopy) kelp is a highly productive macroalgae that grows on rocky substrates in relatively high energy environments. Bull kelp absorbs carbon, mitigates wave energy and provides vital nursery habitat for coastal marine species.`;
const EELGRASS_TEXT = `Eelgrass, a flowering marine plant, requires sandy substrate, clear, clean and relatively protected waters and plenty of light to grow. Eelgrass provides habitat for a range of invertebrates, fish and wildlife, including rearing out-migrating juvenile salmon and spawning Pacific herring. It also sequesters carbon and helps buffer the impacts of waves and coastal erosion.`;
const FORAGE_TEXT = `Surf smelt and Pacific sand lance lay their eggs in the upper beach on sand and fine gravel. These small fish feed salmon, seabirds and marine mammals, so spawning beaches are among the most important — and most easily damaged — shoreline habitats.`;
const HERRING_TEXT = `Pacific herring spawn on eelgrass and algae in sheltered bays. Herring are a keystone forage fish, a primary food for salmon, seabirds and marine mammals.`;

function forageSummary(f: NearshoreVegetationResult['forage']): string {
  const docs = f.documented;
  if (docs.length > 0) {
    const species = new Set<string>();
    for (const d of docs) {
      if (d.smelt) species.add('surf smelt');
      if (d.sandLance) species.add('Pacific sand lance');
      if (!d.smelt && !d.sandLance && d.species) species.add(d.species.toLowerCase());
    }
    const names = docs.map(d => d.name).filter(Boolean);
    const sp = species.size > 0 ? ` (${Array.from(species).join(', ')})` : '';
    return `Documented spawning beach${docs.length > 1 ? 'es' : ''}${names.length ? `: ${esc(names.slice(0, 3).join(', '))}` : ''}${esc(sp)}`;
  }
  if (f.potentialCount > 0) return 'Potential spawning beach — substrate suitable for surf smelt or sand lance';
  return '';
}

function buildNearshoreEcologyCard(veg: NearshoreVegetationResult): string {
  const { bullKelp, eelgrass, forage, herring, distances } = veg;
  const hasKelp = bullKelp.present;
  const hasEelgrass = eelgrass.present;
  const anyVeg = hasKelp || hasEelgrass;

  const dot = (color: string) =>
    `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle;flex-shrink:0;"></span>`;
  const greenDot = dot('#5E8A1E');
  const grayDot = dot(COLOR.border);

  const row = (present: boolean, label: string, detail?: string) => `
    <div style="display:flex;align-items:flex-start;padding:8px 10px;background:${present ? '#E3F1C8' : '#FBF7EF'};border-radius:6px;border:1px solid ${present ? '#B7D98A' : '#E0D6C4'};">
      <span style="margin-top:4px;">${present ? greenDot : grayDot}</span>
      <span style="font-size:15px;color:${present ? '#1F3A08' : COLOR.mid};line-height:1.4;">
        <strong>${label}</strong>${detail ? ` &mdash; ${detail}` : ''}
      </span>
    </div>`;

  const kelpDetail = hasKelp
    ? `${describeKelpExtent(bullKelp.totalAcres).toLowerCase().replace(/ kelp /, ' ')} within ${distances.kelpFt} ft${bullKelp.distFt !== null ? ` (nearest ${bullKelp.distFt} ft)` : ''}`
    : `none mapped within ${distances.kelpFt} ft`;
  const eelDetail = hasEelgrass
    ? `${describeEelgrassExtent(eelgrass.segmentCount, eelgrass.totalLengthFt).toLowerCase().replace(/^eelgrass /, '')} within ${distances.eelgrassFt} ft${eelgrass.distFt !== null ? ` (nearest ${eelgrass.distFt} ft)` : ''}`
    : `deep-water edge not mapped within ${distances.eelgrassFt} ft`;
  const forageDetail = forage.present ? forageSummary(forage) : `none mapped within ${distances.forageFt} ft`;
  const herringDetail = herring.present
    ? `${esc(herring.names.join(', '))} within ${distances.herringFt} ft`
    : `no mapped spawning ground within ${distances.herringFt} ft`;

  const rows = `
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">
      ${row(hasKelp, 'Bull kelp', kelpDetail)}
      ${row(hasEelgrass, 'Eelgrass', eelDetail)}
      ${row(forage.present, 'Forage fish spawning beach', forageDetail)}
      ${row(herring.present, 'Herring spawning ground', herringDetail)}
    </div>`;

  const paragraphs: string[] = [];
  if (hasKelp) paragraphs.push(`<p style="${BODY};line-height:1.5;margin-bottom:8px;"><strong style="color:${COLOR.teal};">Bull kelp.</strong> ${KELP_TEXT}</p>`);
  if (hasEelgrass) paragraphs.push(`<p style="${BODY};line-height:1.5;margin-bottom:8px;"><strong style="color:${COLOR.teal};">Eelgrass.</strong> ${EELGRASS_TEXT}</p>`);
  if (forage.present) paragraphs.push(`<p style="${BODY};line-height:1.5;margin-bottom:8px;"><strong style="color:${COLOR.teal};">Forage fish.</strong> ${FORAGE_TEXT}</p>`);
  if (herring.present) paragraphs.push(`<p style="${BODY};line-height:1.5;margin-bottom:8px;"><strong style="color:${COLOR.teal};">Herring.</strong> ${HERRING_TEXT}</p>`);
  if (!anyVeg) {
    paragraphs.push(`<p style="${BODY};line-height:1.5;color:${COLOR.mid};margin-bottom:8px;">
      No bull kelp or eelgrass beds were identified within ${distances.kelpFt} ft of this property in Friends of the San Juans survey data.
      This does not necessarily indicate poor condition &mdash; these marine plants require specific substrate, depth, and light conditions.
      Kelp needs rocky substrate and higher energy environments and eelgrass needs soft sediment in protected, shallow waters.
    </p>`);
  }

  const significance = anyVeg ? `
    <div style="position:relative;margin-top:4px;padding:14px 16px 14px 20px;background:#EBE1CC;border-radius:10px;border-left:4px solid #B69866;">
      <div style="font-family:'Montserrat',system-ui,sans-serif;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6A5324;margin-bottom:6px;">Ecological Significance</div>
      <p style="font-size:14px;color:${COLOR.dark};line-height:1.6;margin:0;">
        ${hasEelgrass ? `Eelgrass is protected under <strong>Washington State law</strong> and San Juan County's <strong>Environmentally Sensitive Areas</strong> code. ` : ''}
        ${hasKelp ? `Bull kelp is a <strong>priority habitat</strong> for the Washington Department of Fish &amp; Wildlife and is protected under <strong>San Juan County code</strong>. ` : ''}
        Activities that increase sedimentation, shading, or nutrient runoff near this property can affect these habitats.
      </p>
    </div>` : '';

  const learnMoreBlock = `
    <div style="margin-top:14px;padding:12px 14px 12px 16px;background:#F1F7E3;border-radius:10px;border-left:4px solid #92C642;">
      <p style="font-size:15px;color:${COLOR.dark};line-height:1.6;margin:0;">
        Want to know how you can help protect the shoreline around your property?
        <a href="/reports/living-with-the-shoreline.html" target="_blank" rel="noopener noreferrer" style="color:${COLOR.teal};font-weight:600;text-decoration:underline;">Read the guide for shoreline property owners</a>
        &mdash; it's full of practical ideas from your neighbors in the San Juans. You can also
        <a href="/reports/kelp-habitat-value-and-threats.html" target="_blank" rel="noopener noreferrer" style="color:${COLOR.teal};font-weight:600;text-decoration:underline;">learn more about kelp</a>
        and why these underwater forests matter so much to the health of our islands.
      </p>
    </div>`;

  return `
    <div style="${CARD}">
      ${sectionHeading('Nearshore Habitat')}
      ${rows}
      ${paragraphs.join('')}
      ${significance}
      ${learnMoreBlock}
    </div>
  `;
}

function buildGreeneryCard(stats: NdviStats, isWaterfront: boolean, island: IslandPercentile | null, extraHtml = ''): string {
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
          <span style="font-size:22px;font-weight:700;color:${COLOR.teal};">${displayValue}${pct != null ? '<span style="font-size:13px;font-weight:700;color:' + COLOR.mid + ';margin-left:1px;">%</span>' : ''}</span>
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
      ${extraHtml}
      ${comparisonBar}
      ${classBreakdown}
      ${variabilityNote}
      ${moreInfoLink}
    </div>
  `;
}

function buildFishCard(result: ShorelineQueryResult, withinFt?: number, distFt?: number): string {
  const { species } = result;
  const count = species.length;
  const top = species[0];
  const topPct = Math.round(top.hrmValue * 100);

  const intro = count === 1
    ? `Survey data shows ${pill(top.species)} using the shallow-water habitat along this shoreline.`
    : `Survey data shows ${pill(String(count) + ' fish species')} using the shallow-water habitat along this shoreline. ${esc(top.species)} scores highest at ${pill(topPct + '%')}.`;

  const hrmDesc = `The shorelines of the San Juans are critical rearing, resting and feeding habitat for out-migrating juvenile salmon from rivers across Puget Sound and southern British Columbia, as well as other fish species that support marine food webs. These scores show what species of fish are using the shallow water habitats in this region of the county. Higher scores mean higher fish presence and abundance for that species, relative to other places in the county.`;

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
      ${sectionHeading('Fish Utilization')}
      <p style="${BODY};margin-bottom:8px;">${intro}</p>
      <p style="${BODY};margin-bottom:12px;color:${COLOR.mid};">${hrmDesc} ${moreInfoLink}</p>
      <div style="font-size:14px;color:${COLOR.dark};margin-bottom:6px;">Habitat relevance score</div>
      ${bars}
      ${withinFt != null ? `<p style="font-size:13.5px;color:${COLOR.mid};margin:10px 0 0;line-height:1.45;">Scores are for the surveyed shoreline segment${distFt != null && distFt > 0 ? ` ${distFt} ft from the parcel line` : ' along this parcel'} (segments within ${withinFt} ft are considered). Source: Beamer &amp; Fresh 2012, Skagit River System Cooperative.</p>` : ''}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Nearshore vegetation panel (Bull Kelp + Eelgrass)
// ---------------------------------------------------------------------------

function describeKelpExtent(acres: number): string {
  if (acres >= 5) return 'Extensive kelp canopy';
  if (acres >= 1) return 'Moderate kelp presence';
  if (acres >= 0.1) return 'Small kelp patches';
  return 'Trace kelp presence';
}

function describeKelpDensity(featureCount: number): string {
  return featureCount === 1 ? 'one mapped patch' : `${featureCount} mapped patches`;
}

function describeEelgrassExtent(segmentCount: number, totalLengthFt: number): string {
  if (totalLengthFt >= 5000) return 'Extensive eelgrass coverage';
  if (totalLengthFt >= 1000) return 'Moderate eelgrass presence';
  if (segmentCount >= 3) return 'Multiple eelgrass survey sites';
  return 'Eelgrass detected nearby';
}

function buildNearshoreVegetationHtml(veg: NearshoreVegetationResult, mode: 'veg' | 'spawn' = 'veg'): string {
  const { bullKelp, eelgrass, forage, herring, distances } = veg;

  const vegIcon = (present: boolean) => present
    ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#22C55E;margin-right:6px;vertical-align:middle;"></span>`
    : `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${COLOR.border};margin-right:6px;vertical-align:middle;"></span>`;

  const stat = (value: string, label: string, color: string) => `
    <div style="text-align:center;flex:1;min-width:70px;padding:8px;background:white;border-radius:6px;">
      <div style="font-size:18px;font-weight:700;color:${color};">${value}</div>
      <div style="font-size:14px;color:${COLOR.mid};text-transform:uppercase;letter-spacing:0.5px;">${label}</div>
    </div>`;

  const absent = (label: string) => `
    <div style="display:flex;align-items:center;padding:8px 12px;background:${COLOR.bg};border-radius:6px;margin-bottom:8px;">
      ${vegIcon(false)}
      <span style="font-size:14.5px;color:${COLOR.mid};">${label}</span>
    </div>`;

  // --- Bull Kelp ---
  let kelpHtml = '';
  if (bullKelp.present) {
    const extent = describeKelpExtent(bullKelp.totalAcres);
    const density = describeKelpDensity(bullKelp.featureCount);
    const acresStr = bullKelp.totalAcres >= 0.1 ? bullKelp.totalAcres.toFixed(1) : '< 0.1';
    kelpHtml = `
      <div style="padding:12px;background:#F0FDF4;border-radius:8px;border:1px solid #BBF7D0;margin-bottom:10px;">
        <div style="display:flex;align-items:center;margin-bottom:6px;">
          ${vegIcon(true)}
          <span style="font-size:14px;font-weight:700;color:#1F3A08;">Bull Kelp Present</span>
        </div>
        <p style="${BODY};color:#3D6410;margin-bottom:8px;">
          ${extent}, ${density} within ${distances.kelpFt} ft of this property.
        </p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          ${stat(acresStr, 'Acres (approx.)', '#1F3A08')}
          ${bullKelp.distFt !== null ? stat(String(bullKelp.distFt), 'Nearest (ft)', '#1F3A08') : ''}
          ${stat(bullKelp.featureCount.toLocaleString(), bullKelp.featureCount === 1 ? 'Patch' : 'Patches', '#1F3A08')}
        </div>
        <p style="font-size:14.5px;color:${COLOR.mid};margin-top:8px;line-height:1.45;">${KELP_TEXT}</p>
      </div>
    `;
  } else {
    kelpHtml = absent(`No bull kelp mapped within ${distances.kelpFt} ft`);
  }

  // --- Eelgrass ---
  let eelgrassHtml = '';
  if (eelgrass.present) {
    const extent = describeEelgrassExtent(eelgrass.segmentCount, eelgrass.totalLengthFt);
    const lengthStr = eelgrass.totalLengthFt >= 1 ? Math.round(eelgrass.totalLengthFt).toLocaleString() : '—';
    const depthStr = eelgrass.meanDepth !== null ? eelgrass.meanDepth.toFixed(1) : '—';
    const maxDepthStr = eelgrass.maxDepth !== null ? eelgrass.maxDepth.toFixed(1) : '—';
    const sitesStr = eelgrass.sites.length > 0 ? eelgrass.sites.slice(0, 3).join(', ') : '';
    eelgrassHtml = `
      <div style="padding:12px;background:#F0FDFA;border-radius:8px;border:1px solid #99F6E4;margin-bottom:10px;">
        <div style="display:flex;align-items:center;margin-bottom:6px;">
          ${vegIcon(true)}
          <span style="font-size:14px;font-weight:700;color:#1F3A08;">Eelgrass Present</span>
        </div>
        <p style="${BODY};color:#3D6410;margin-bottom:8px;">
          ${extent} within ${distances.eelgrassFt} ft of this property${eelgrass.segmentCount > 1 ? ` across ${eelgrass.segmentCount} survey transects` : ''}.
          The mapped line is the deep-water edge of the meadow; the meadow extends from there toward shore.
        </p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          ${eelgrass.distFt !== null ? stat(String(eelgrass.distFt), 'Nearest (ft)', '#1F3A08') : ''}
          ${lengthStr !== '—' ? stat(lengthStr, 'Length (ft)', '#1F3A08') : ''}
          ${depthStr !== '—' ? stat(depthStr, 'Avg depth', '#1F3A08') : ''}
          ${maxDepthStr !== '—' ? stat(maxDepthStr, 'Max depth', '#1F3A08') : ''}
        </div>
        ${sitesStr ? `<p style="font-size:14px;color:${COLOR.mid};margin-top:8px;">Survey sites: ${esc(sitesStr)}</p>` : ''}
        <p style="font-size:14.5px;color:${COLOR.mid};margin-top:8px;line-height:1.45;">${EELGRASS_TEXT}</p>
      </div>
    `;
  } else {
    eelgrassHtml = absent(`No eelgrass deep-water edge mapped within ${distances.eelgrassFt} ft`);
  }

  // --- Forage fish spawning beaches ---
  let forageHtml = '';
  if (forage.present) {
    const beachRows = forage.documented.map(d => {
      const sp = [d.smelt ? 'surf smelt' : '', d.sandLance ? 'Pacific sand lance' : ''].filter(Boolean).join(', ') || d.species;
      return `<li style="margin:2px 0;">${esc(d.name || 'Unnamed beach')}${sp ? ` &mdash; ${esc(sp)}` : ''}${d.distFt > 0 ? ` <span style="color:${COLOR.light};">(${d.distFt} ft)</span>` : ''}</li>`;
    }).join('');
    forageHtml = `
      <div style="padding:12px;background:#FDE9C8;border-radius:8px;border:1px solid #F3CF98;margin-bottom:10px;">
        <div style="display:flex;align-items:center;margin-bottom:6px;">
          ${vegIcon(true)}
          <span style="font-size:14px;font-weight:700;color:#6E3D03;">Forage Fish Spawning Beach</span>
        </div>
        ${forage.documented.length > 0 ? `
          <p style="${BODY};color:#6E3D03;margin-bottom:6px;">Documented spawning within ${distances.forageFt} ft of this property:</p>
          <ul style="margin:0 0 8px 18px;padding:0;font-size:14px;color:${COLOR.dark};">${beachRows}</ul>` : `
          <p style="${BODY};color:#6E3D03;margin-bottom:6px;">Potential spawning habitat within ${distances.forageFt} ft &mdash; beach substrate suitable for surf smelt or Pacific sand lance.</p>`}
        ${forage.documented.length > 0 && forage.potentialCount > 0 ? `<p style="font-size:14px;color:${COLOR.mid};margin:0 0 6px;">Also mapped as potential spawning habitat.</p>` : ''}
        <p style="font-size:14.5px;color:${COLOR.mid};margin-top:4px;line-height:1.45;">${FORAGE_TEXT}</p>
      </div>
    `;
  } else {
    forageHtml = absent(`No forage fish spawning beach mapped within ${distances.forageFt} ft`);
  }

  // --- Herring spawning grounds ---
  let herringHtml = '';
  if (herring.present) {
    herringHtml = `
      <div style="padding:12px;background:#D8F0F7;border-radius:8px;border:1px solid #A9D9E8;margin-bottom:10px;">
        <div style="display:flex;align-items:center;margin-bottom:6px;">
          ${vegIcon(true)}
          <span style="font-size:14px;font-weight:700;color:#045A6E;">Herring Spawning Ground</span>
        </div>
        <p style="${BODY};color:#045A6E;margin-bottom:6px;">${esc(herring.names.join(', '))}, a mapped Pacific herring spawning ground (present or historic), lies within ${distances.herringFt} ft of this property.</p>
        <p style="font-size:14.5px;color:${COLOR.mid};margin-top:4px;line-height:1.45;">${HERRING_TEXT}</p>
      </div>
    `;
  } else {
    herringHtml = absent(`No herring spawning ground mapped within ${distances.herringFt} ft`);
  }

  if (mode === 'spawn') {
    return `
    <div style="${CARD}">
      ${sectionHeading('Spawning Habitat')}
      <p style="${BODY};margin-bottom:12px;color:${COLOR.mid};">
        Friends of the San Juans and WDFW survey data: forage fish spawning beaches within ${distances.forageFt} ft of the property and herring spawning grounds within ${distances.herringFt} ft.
      </p>
      ${forageHtml}
      ${herringHtml}
    </div>
  `;
  }
  return `
    <div style="${CARD}">
      ${sectionHeading('Nearshore Habitat')}
      <p style="${BODY};margin-bottom:12px;color:${COLOR.mid};">
        Friends of the San Juans survey data: bull kelp and eelgrass within ${distances.kelpFt} ft of the property.
      </p>
      ${kelpHtml}
      ${eelgrassHtml}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Shoreline tab (full detail)
// ---------------------------------------------------------------------------



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

