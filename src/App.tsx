import { useState, useCallback, useEffect, useRef } from 'react';
import { MapContainer } from './components/Map/MapContainer';
import { LayerControls } from './components/Map/LayerControls';
import { FeaturePopup, PARCEL_SEARCH_EVENT, OPEN_PARCEL_POPUP_EVENT } from './components/Map/FeaturePopup';
import type { ParcelSearchDetail, OpenParcelPopupDetail } from './components/Map/FeaturePopup';
import { RadiusOverlay } from './components/Map/RadiusOverlay';
import { AddressSearch } from './components/Search/AddressSearch';
import { Header } from './components/Layout/Header';
import { Sidebar } from './components/Layout/Sidebar';
import { useMap } from './hooks/useMap';
import { useLayers } from './hooks/useLayers';
import type { GeocodingResult } from './types';

export default function App() {
  return <AppShell />;
}

/**
 * Outer shell: owns sidebar state and renders MapContainer.
 * Cannot call useMap() — it's the parent of MapContext.Provider.
 * Uses a ref to bridge the search callback to the inner content.
 */
function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const placeSelectedRef = useRef<(result: GeocodingResult) => void>(() => {});

  const headerEl = (
    <Header
      onToggleSidebar={() => setSidebarOpen(s => !s)}
      sidebarOpen={sidebarOpen}
      searchBar={
        <AddressSearch
          onPlaceSelected={(r) => placeSelectedRef.current(r)}
          isSearching={false}
        />
      }
    />
  );

  return (
    <MapContainer header={headerEl}>
      <AppContent
        sidebarOpen={sidebarOpen}
        placeSelectedRef={placeSelectedRef}
      />
    </MapContainer>
  );
}

/**
 * Inner content: rendered as a child of MapContainer, so useMap() works.
 */
interface AppContentProps {
  sidebarOpen: boolean;
  placeSelectedRef: React.MutableRefObject<(result: GeocodingResult) => void>;
}

function AppContent({ sidebarOpen, placeSelectedRef }: AppContentProps) {
  const { map } = useMap();
  const { layers, toggleLayer, setAllVisible, setLayerOpacity, setDynamicRasterTileUrl } = useLayers(map);

  const [searchCenter, setSearchCenter] = useState<{ lat: number; lng: number } | null>(null);

  const handlePlaceSelected = useCallback((result: GeocodingResult) => {
    setSearchCenter({ lat: result.lat, lng: result.lng });
    // Open the tabbed parcel popup (same as clicking a parcel on the map)
    window.dispatchEvent(new CustomEvent<OpenParcelPopupDetail>(OPEN_PARCEL_POPUP_EVENT, {
      detail: { lat: result.lat, lng: result.lng },
    }));
  }, []);

  // Keep the ref bridge in sync so the header's AddressSearch can reach us
  placeSelectedRef.current = handlePlaceSelected;

  // Listen for parcel-click address searches
  useEffect(() => {
    const handler = (e: Event) => {
      const { lat, lng, formattedAddress } = (e as CustomEvent<ParcelSearchDetail>).detail;
      handlePlaceSelected({ lat, lng, formattedAddress });
    };
    window.addEventListener(PARCEL_SEARCH_EVENT, handler);
    return () => window.removeEventListener(PARCEL_SEARCH_EVENT, handler);
  }, [handlePlaceSelected]);

  return (
    <>
      <RadiusOverlay
        center={searchCenter}
        radiusMeters={402}
      />

      <FeaturePopup layers={layers} />

      <Sidebar open={sidebarOpen}>
        <LayerControls
          layers={layers}
          onToggleLayer={toggleLayer}
          onSetAllVisible={setAllVisible}
          onSetLayerOpacity={setLayerOpacity}
          onSetDynamicTileUrl={setDynamicRasterTileUrl}
        />
      </Sidebar>
    </>
  );
}
