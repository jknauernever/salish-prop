import { createContext, useContext } from 'react';

interface MapContextValue {
  map: google.maps.Map | null;
  isLoaded: boolean;
}

export const MapContext = createContext<MapContextValue>({
  map: null,
  isLoaded: false,
});

export function useMap() {
  return useContext(MapContext);
}
