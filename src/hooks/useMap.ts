import { createContext, useContext } from 'react';

interface MapContextValue {
  map: google.maps.Map | null;
  isLoaded: boolean;
  /** Current map zoom (updates on zoom_changed). */
  zoom: number;
}

export const MapContext = createContext<MapContextValue>({
  map: null,
  isLoaded: false,
  zoom: 0,
});

export function useMap() {
  return useContext(MapContext);
}
