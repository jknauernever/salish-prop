import { useEffect, useRef } from 'react';
import { useMap } from '../../hooks/useMap';
import { highlightFeatureGeometry, clearFeatureHighlight } from './featureHighlight';
import type { LayerState } from '../../types';
import { buildPopupFrame, installPopupFrameHandlers, POPUP_CLOSE_EVENT } from './popupFrame';
import { LAYER_PHOTOS } from '../../config/popups';

interface DistAlertPopupProps {
  layers: LayerState[];
}

/**
 * Map-level click listener that surfaces per-pixel DIST-ALERT info when the
 * opera-dist-alert raster layer is visible. Mirrors ForestLossPopup: clicks
 * that hit a vector feature don't reach map-level (those layers intercept
 * first), so this only fires on otherwise-empty regions including the
 * colored disturbance pixels.
 */
// Length (in screen pixels) of the connecting "neck" between the clicked
// pixel and the InfoWindow's tail. Matched with `pixelOffset` so the line and
// the InfoWindow tail share an endpoint.
const NECK_PX = 55;

const LAYER_ID = 'opera-dist-alert';
const ACCENT = '#D9480F';

function rasterFrame(layer: LayerState | undefined, title: string, subtitle: string, opts: {
  stats?: { value: string; unit?: string; label: string }[];
  story?: { kicker: string; html: string };
  chips?: { label: string; tone?: 'default' | 'on' | 'warn' | 'teal' }[];
} = {}): string {
  return buildPopupFrame({
    id: `${LAYER_ID}-${Date.now()}`,
    accent: ACCENT,
    layerName: layer?.config.name ?? 'Forest Disturbance (DIST-ALERT)',
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

export function DistAlertPopup({ layers }: DistAlertPopupProps) {
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

  const layer = layers.find((l) => l.config.id === 'opera-dist-alert');
  const visible = !!layer?.visible;
  const endpoint = layer?.config.apiEndpoint;

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

      iw.setContent(rasterFrame(layerNow(), 'Forest disturbance', 'Looking up this location…'));
      iw.setPosition(event.latLng);
      iw.open(map);
      showNeck(map, event.latLng);

      try {
        const res = await fetch(`${endpointRef.current}?lat=${lat}&lng=${lng}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: {
          date: string | null;
          statusCode: number;
          statusLabel: string | null;
          severity: number | null;
          pixelCount?: number;
          acres?: number;
          truncated?: boolean;
          patchGeometry?: GeoJSON.Geometry | null;
        } = await res.json();

        if (!data.date) {
          clearFeatureHighlight();
          iw.setContent(rasterFrame(layerNow(), 'No vegetation disturbance recorded here', `${lat.toFixed(4)}, ${lng.toFixed(4)}`));
          return;
        }

        if (data.patchGeometry) {
          highlightFeatureGeometry(data.patchGeometry, map);
        }

        const prettyDate = new Date(data.date).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        const severityStr = data.severity != null
          ? `${Math.round(data.severity)}% vegetation loss`
          : 'severity unknown';
        const acresStr = data.acres != null && data.acres >= 0.01
          ? `${data.acres.toFixed(2)} acre${Math.abs(data.acres - 1) < 0.005 ? '' : 's'}`
          : '&lt; 0.01 acres';
        const truncatedNote = data.truncated
          ? ' <span style="color:#8B6914;">(very large patch — area underestimated)</span>'
          : '';

        void severityStr; void acresStr; void truncatedNote;
        const d = new Date(data.date);
        iw.setContent(rasterFrame(layerNow(), 'Disturbance detected', `${prettyDate} · ${lat.toFixed(4)}, ${lng.toFixed(4)}`, {
          stats: [
            { value: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), label: `First seen ${d.getFullYear()}` },
            { value: data.severity != null ? `${Math.round(data.severity)}%` : '—', label: 'Vegetation loss' },
            { value: data.acres != null && data.acres >= 0.01 ? data.acres.toFixed(2) : '< 0.01', unit: 'ac', label: 'Connected patch' },
          ],
          chips: [
            ...(data.statusLabel ? [{ label: data.statusLabel, tone: 'teal' as const }] : []),
            ...(data.truncated ? [{ label: 'Very large patch — area underestimated', tone: 'warn' as const }] : []),
          ],
          story: { kicker: 'What this is', html: 'Satellite-detected loss of vegetation cover since the previous season, from NASA\'s OPERA DIST-ALERT product. It flags clearing and storm damage; it cannot tell a permit-approved harvest from anything else.' },
        }));
      } catch (err) {
        console.error('DIST-ALERT lookup failed:', err);
        iw.setContent(rasterFrame(layerNow(), 'Lookup failed', 'Could not reach the disturbance service.'));
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
