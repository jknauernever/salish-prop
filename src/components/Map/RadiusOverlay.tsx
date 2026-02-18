import { useEffect, useRef } from 'react';
import { importLibrary } from '@googlemaps/js-api-loader';
import { useMap } from '../../hooks/useMap';

interface RadiusOverlayProps {
  center: { lat: number; lng: number } | null;
  radiusMeters: number;
}

export function RadiusOverlay({ center, radiusMeters }: RadiusOverlayProps) {
  const { map } = useMap();
  const circleRef = useRef<google.maps.Circle | null>(null);
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const markerLibRef = useRef<google.maps.MarkerLibrary | null>(null);

  useEffect(() => {
    importLibrary('marker').then((lib) => {
      markerLibRef.current = lib as google.maps.MarkerLibrary;
    });
  }, []);

  useEffect(() => {
    if (!map || !center) {
      circleRef.current?.setMap(null);
      if (markerRef.current) {
        markerRef.current.map = null;
      }
      return;
    }

    // Update or create circle
    if (circleRef.current) {
      circleRef.current.setCenter(center);
      circleRef.current.setRadius(radiusMeters);
    } else {
      circleRef.current = new google.maps.Circle({
        map,
        center,
        radius: radiusMeters,
        fillColor: '#0D4F4F',
        fillOpacity: 0.08,
        strokeColor: '#0D4F4F',
        strokeOpacity: 0.5,
        strokeWeight: 2,
        clickable: false,
      });
    }

    // Update or create marker
    if (markerRef.current) {
      markerRef.current.position = center;
    } else if (markerLibRef.current) {
      const pinEl = document.createElement('div');
      pinEl.innerHTML = `
        <div style="
          width: 32px; height: 32px;
          background: #0D4F4F;
          border: 3px solid white;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        "></div>
      `;
      markerRef.current = new markerLibRef.current.AdvancedMarkerElement({
        map,
        position: center,
        content: pinEl,
      });
    }

    // Zoom to fit the radius
    const bounds = circleRef.current.getBounds();
    if (bounds) {
      map.fitBounds(bounds, 50);
    }
  }, [map, center, radiusMeters]);

  // Clean up on full unmount
  useEffect(() => {
    return () => {
      circleRef.current?.setMap(null);
      if (markerRef.current) {
        markerRef.current.map = null;
      }
    };
  }, []);

  return null;
}
