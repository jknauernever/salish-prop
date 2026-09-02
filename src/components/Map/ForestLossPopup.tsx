import { useEffect, useRef } from 'react';
import { useMap } from '../../hooks/useMap';
import { highlightFeatureGeometry, clearFeatureHighlight } from './featureHighlight';
import type { LayerState } from '../../types';
import { buildPopupFrame, installPopupFrameHandlers, POPUP_CLOSE_EVENT } from './popupFrame';
import { LAYER_PHOTOS } from '../../config/popups';

interface ForestLossPopupProps {
  layers: LayerState[];
}

/**
 * Map-level click listener that surfaces per-patch forest-loss info when the
 * forest-loss raster layer is visible. Clicks that hit a vector feature
 * (parcels, habitat lines, etc.) don't reach map-level — those layers
 * intercept first — so this only fires for clicks on otherwise-empty map
 * regions, including the colored Hansen pixels.
 */
// Length (in screen pixels) of the connecting "neck" between the clicked
// pixel and the InfoWindow's tail. Matched with `pixelOffset` so the line and
// the InfoWindow tail share an endpoint.
const NECK_PX = 55;

const LAYER_ID = 'forest-loss';
const ACCENT = '#D9480F';

function rasterFrame(layer: LayerState | undefined, title: string, subtitle: string, opts: {
  stats?: { value: string; unit?: string; label: string }[];
  story?: { kicker: string; html: string };
  chips?: { label: string; tone?: 'default' | 'on' | 'warn' | 'teal' }[];
} = {}): string {
  return buildPopupFrame({
    id: `${LAYER_ID}-${Date.now()}`,
    accent: ACCENT,
    layerName: layer?.config.name ?? 'Forest Loss (2001–2025)',
    swatch: 'fill',
    title,
    subtitle,
    photos: LAYER_PHOTOS[LAYER_ID] ? [LAYER_PHOTOS[LAYER_ID]] : [],
    stats: opts.stats,
    chips: opts.chips,
    story: opts.story,
    source: { credit: layer?.config.sourceCredit, url: layer?.config.sourceUrl },
  });
}

export function ForestLossPopup({ layers }: ForestLossPopupProps) {
  const { map } = useMap();
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const neckRef = useRef<google.maps.Marker | null>(null);

  const hideNeck = () => {
    if (neckRef.current) neckRef.current.setMap(null);
  };
  const showNeck = (m: google.maps.Map, position: google.maps.LatLng) => {
    if (!neckRef.current) {
      neckRef.current = new google.maps.Marker({
        clickable: false,
        zIndex: 9999,
        icon: {
          path: `M 0 0 L 0 -${NECK_PX}`,
          strokeColor: '#F97316',
          strokeOpacity: 0.9,
          strokeWeight: 2,
          scale: 1,
          anchor: new google.maps.Point(0, 0),
        },
      });
    }
    neckRef.current.setPosition(position);
    neckRef.current.setMap(m);
  };

  const layer = layers.find((l) => l.config.id === 'forest-loss');
  const visible = !!layer?.visible;
  const endpoint = layer?.config.apiEndpoint;

  // Refs so the persistent click listener reads current values without re-attaching.
  const layerRef = useRef(layer);
  layerRef.current = layer;
  const layerNow = () => layerRef.current;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const endpointRef = useRef(endpoint);
  endpointRef.current = endpoint;

  useEffect(() => {
    if (!map) return;

    if (!infoWindowRef.current) {
      // pixelOffset lifts the InfoWindow's tail tip NECK_PX above the click
      // point; the neck marker draws a visible line of the same length from
      // the click to the tail tip, so they look like one continuous connector.
      infoWindowRef.current = new google.maps.InfoWindow({
        pixelOffset: new google.maps.Size(0, -NECK_PX),
      });
      infoWindowRef.current.addListener('closeclick', () => {
        clearFeatureHighlight();
        hideNeck();
      });
      installPopupFrameHandlers();
    }
    const iwForClose = infoWindowRef.current;
    const onFrameClose = () => {
      if (!iwForClose.isOpen) return;
      iwForClose.close();
      clearFeatureHighlight();
      hideNeck();
    };
    window.addEventListener(POPUP_CLOSE_EVENT, onFrameClose);

    const handler = async (event: google.maps.MapMouseEvent) => {
      if (!visibleRef.current || !endpointRef.current || !event.latLng) return;
      const iw = infoWindowRef.current;
      if (!iw) return;

      const lat = event.latLng.lat();
      const lng = event.latLng.lng();

      iw.setContent(rasterFrame(layerNow(), 'Forest loss', 'Looking up this location…'));
      iw.setPosition(event.latLng);
      iw.open(map);
      showNeck(map, event.latLng);

      try {
        const res = await fetch(
          `${endpointRef.current}?lat=${lat}&lng=${lng}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: {
          year: number | null;
          acres: number;
          truncated?: boolean;
          patchGeometry?: GeoJSON.Geometry | null;
        } = await res.json();

        if (!data.year) {
          clearFeatureHighlight();
          iw.setContent(rasterFrame(layerNow(), 'No forest loss recorded here', `${lat.toFixed(4)}, ${lng.toFixed(4)}`));
          return;
        }

        if (data.patchGeometry) {
          highlightFeatureGeometry(data.patchGeometry, map);
        }

        const acresStr = data.acres >= 0.01
          ? `${data.acres.toFixed(2)} acre${Math.abs(data.acres - 1) < 0.005 ? '' : 's'}`
          : '&lt; 0.01 acres';
        const truncatedNote = data.truncated
          ? ' <span style="color:#8B6914;">(very large patch &mdash; area underestimated)</span>'
          : '';
        void acresStr; void truncatedNote;
        iw.setContent(rasterFrame(layerNow(), `Forest loss in ${data.year}`, `${lat.toFixed(4)}, ${lng.toFixed(4)}`, {
          stats: [
            { value: String(data.year), label: 'Year of loss' },
            { value: data.acres >= 0.01 ? data.acres.toFixed(2) : '< 0.01', unit: 'ac', label: 'Connected patch' },
          ],
          chips: data.truncated ? [{ label: 'Very large patch — area underestimated', tone: 'warn' }] : [],
          story: { kicker: 'What this is', html: 'Tree cover lost in this year according to Landsat, from the Hansen Global Forest Change dataset. It records clearing, fire, and storm damage alike; it cannot tell a permitted harvest from anything else.' },
        }));
      } catch (err) {
        console.error('Forest loss lookup failed:', err);
        iw.setContent(rasterFrame(layerNow(), 'Lookup failed', 'Could not reach the forest-loss service.'));
      }
    };

    const listener = map.addListener('click', handler);
    return () => {
      google.maps.event.removeListener(listener);
      window.removeEventListener(POPUP_CLOSE_EVENT, onFrameClose);
    };
  }, [map]);

  return null;
}
