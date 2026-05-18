import { useEffect, useRef } from 'react';
import { useMap } from '../../hooks/useMap';
import { highlightFeatureGeometry, clearFeatureHighlight } from './featureHighlight';
import type { LayerState } from '../../types';

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
    }

    const handler = async (event: google.maps.MapMouseEvent) => {
      if (!visibleRef.current || !endpointRef.current || !event.latLng) return;
      const iw = infoWindowRef.current;
      if (!iw) return;

      const lat = event.latLng.lat();
      const lng = event.latLng.lng();

      iw.setContent(
        '<div style="padding:6px 10px;font-size:12px;color:#2C3E50;">Looking up disturbance alert…</div>',
      );
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
          iw.setContent(
            '<div style="padding:6px 10px;font-size:12px;color:#2C3E50;">No vegetation disturbance recorded at this location.</div>',
          );
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

        iw.setContent(
          `<div style="padding:6px 10px;font-size:12px;color:#2C3E50;line-height:1.5;min-width:220px;">
             <div style="font-weight:600;margin-bottom:2px;">Disturbance detected ${prettyDate}</div>
             <div>${data.statusLabel ?? ''}</div>
             <div>${severityStr}</div>
             <div style="margin-top:4px;color:#5D6D7E;">${acresStr} in this connected patch${truncatedNote}</div>
           </div>`,
        );
      } catch (err) {
        console.error('DIST-ALERT lookup failed:', err);
        iw.setContent(
          '<div style="padding:6px 10px;font-size:12px;color:#B91C1C;">Failed to look up disturbance data.</div>',
        );
      }
    };

    const listener = map.addListener('click', handler);
    return () => {
      google.maps.event.removeListener(listener);
    };
  }, [map]);

  return null;
}
