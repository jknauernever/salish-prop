import { useEffect, useRef, useState } from 'react';
import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { MapContext } from '../../hooks/useMap';
import { Footer } from '../Layout/Footer';
import { setUrlParams, fmtLatLng } from '../../services/urlState';
import type { ReactNode } from 'react';

const SAN_JUAN_CENTER = { lat: 48.605, lng: -123.0 };
const DEFAULT_ZOOM = 10.8;

setOptions({
  key: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
  v: 'weekly',
  libraries: ['places', 'geocoding', 'marker'],
});

interface MapContainerProps {
  header?: ReactNode;
  children: ReactNode;
  initialView?: {
    center: { lat: number; lng: number };
    zoom: number;
  };
  /** Basemap to start on (roadmap | satellite | hybrid | terrain). Defaults to hybrid. */
  initialMapTypeId?: string;
}

export function MapContainer({ header, children, initialView, initialMapTypeId }: MapContainerProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startCenter = initialView?.center ?? SAN_JUAN_CENTER;
  const startZoom = initialView?.zoom ?? DEFAULT_ZOOM;
  const [zoom, setZoom] = useState(startZoom);

  useEffect(() => {
    let mounted = true;

    importLibrary('maps').then((mapsLib) => {
      if (!mounted || !mapRef.current) return;

      const { Map } = mapsLib as google.maps.MapsLibrary;
      const mapInstance = new Map(mapRef.current, {
        center: startCenter,
        zoom: startZoom,
        mapId: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID,
        mapTypeId: initialMapTypeId ?? google.maps.MapTypeId.HYBRID,
        disableDefaultUI: false,
        zoomControl: true,
        mapTypeControl: true,
        mapTypeControlOptions: {
          position: google.maps.ControlPosition.TOP_RIGHT,
          style: google.maps.MapTypeControlStyle.DROPDOWN_MENU,
        },
        scaleControl: true,
        streetViewControl: false,
        fullscreenControl: true,
        gestureHandling: 'greedy',
      });

      mapInstance.addListener('zoom_changed', () => {
        setZoom(mapInstance.getZoom() ?? DEFAULT_ZOOM);
      });

      // Mirror the viewport + basemap into the URL so the address bar is
      // always a shareable link to exactly this view.
      mapInstance.addListener('idle', () => {
        const c = mapInstance.getCenter();
        const z = mapInstance.getZoom();
        if (!c || z == null) return;
        setUrlParams({ c: fmtLatLng(c.lat(), c.lng()), z: (Math.round(z * 100) / 100).toString() });
      });
      mapInstance.addListener('maptypeid_changed', () => {
        const t = mapInstance.getMapTypeId();
        setUrlParams({ b: t && t !== google.maps.MapTypeId.HYBRID ? String(t) : null });
      });

      setMap(mapInstance);
      setIsLoaded(true);
    }).catch((err) => {
      if (!mounted) return;
      console.error('Google Maps failed to load:', err);
      setError(err instanceof Error ? err.message : 'Failed to load Google Maps');
    });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <MapContext.Provider value={{ map, isLoaded, zoom }}>
      <div className="h-full flex flex-col bg-fog-gray">
        {header}
        <div className="relative flex-1">
          <div ref={mapRef} className="absolute inset-0" />
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-fog-gray z-50">
              <div className="text-center p-8 max-w-md">
                <p className="text-lg font-semibold text-slate-blue mb-2">Map failed to load</p>
                <p className="text-sm text-slate-blue/60 mb-4">{error}</p>
                <p className="text-xs text-slate-blue/40">
                  Check that your Google Maps API key is valid and has Maps JavaScript API, Places API, and Geocoding API enabled.
                </p>
              </div>
            </div>
          )}
          {!isLoaded && !error && (
            <div className="absolute inset-0 flex items-center justify-center bg-fog-gray z-50">
              <div className="text-center">
                <div className="animate-spin h-8 w-8 border-2 border-deep-teal border-t-transparent rounded-full mx-auto mb-3"></div>
                <p className="text-sm text-slate-blue/60">Loading map...</p>
              </div>
            </div>
          )}
          {isLoaded && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-slate-blue/80 text-white text-xs font-mono px-3 py-1 rounded-full z-10 pointer-events-none">
              Zoom {Math.round(zoom * 10) / 10}
            </div>
          )}
          {isLoaded && children}
        </div>
        <Footer />
      </div>
    </MapContext.Provider>
  );
}
