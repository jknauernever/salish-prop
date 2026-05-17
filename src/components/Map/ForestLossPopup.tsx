import { useEffect, useRef } from 'react';
import { useMap } from '../../hooks/useMap';
import { highlightFeatureGeometry, clearFeatureHighlight } from './featureHighlight';
import type { LayerState } from '../../types';

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
export function ForestLossPopup({ layers }: ForestLossPopupProps) {
  const { map } = useMap();
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  const forestLayer = layers.find((l) => l.config.id === 'forest-loss');
  const visible = !!forestLayer?.visible;
  const endpoint = forestLayer?.config.apiEndpoint;

  // Refs so the persistent click listener reads current values without re-attaching.
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const endpointRef = useRef(endpoint);
  endpointRef.current = endpoint;

  useEffect(() => {
    if (!map) return;

    if (!infoWindowRef.current) {
      infoWindowRef.current = new google.maps.InfoWindow();
      infoWindowRef.current.addListener('closeclick', clearFeatureHighlight);
    }

    const handler = async (event: google.maps.MapMouseEvent) => {
      if (!visibleRef.current || !endpointRef.current || !event.latLng) return;
      const iw = infoWindowRef.current;
      if (!iw) return;

      const lat = event.latLng.lat();
      const lng = event.latLng.lng();

      iw.setContent(
        '<div style="padding:6px 10px;font-size:12px;color:#2C3E50;">Looking up forest loss…</div>',
      );
      iw.setPosition(event.latLng);
      iw.open(map);

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
          iw.setContent(
            '<div style="padding:6px 10px;font-size:12px;color:#2C3E50;">No forest loss recorded at this location.</div>',
          );
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
        iw.setContent(
          `<div style="padding:6px 10px;font-size:12px;color:#2C3E50;line-height:1.5;min-width:180px;">
             <div style="font-weight:600;margin-bottom:2px;">Forest loss in ${data.year}</div>
             <div>${acresStr} in this connected patch${truncatedNote}</div>
           </div>`,
        );
      } catch (err) {
        console.error('Forest loss lookup failed:', err);
        iw.setContent(
          '<div style="padding:6px 10px;font-size:12px;color:#B91C1C;">Failed to look up forest loss data.</div>',
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
