import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MapContainer } from './components/Map/MapContainer';
import { LayerControls } from './components/Map/LayerControls';
import { FeaturePopup, PARCEL_SEARCH_EVENT, OPEN_PARCEL_POPUP_EVENT } from './components/Map/FeaturePopup';
import { ForestLossPopup } from './components/Map/ForestLossPopup';
import { DistAlertPopup } from './components/Map/DistAlertPopup';
import type { ParcelSearchDetail, OpenParcelPopupDetail } from './components/Map/FeaturePopup';
import { RadiusOverlay } from './components/Map/RadiusOverlay';
import { LandingIntro } from './components/Map/LandingIntro';
import { AddressSearch } from './components/Search/AddressSearch';
import { Header } from './components/Layout/Header';
import { Sidebar } from './components/Layout/Sidebar';
import { useMap } from './hooks/useMap';
import { useLayers } from './hooks/useLayers';
import { useSiteContent } from './services/siteContent';
import type { GeocodingResult } from './types';
import type { LockableControl, Preset } from './config/presets';

const ALL_LOCKABLE_CONTROLS: LockableControl[] = ['layers', 'search'];

function computeLockedSet(preset: Preset | null): Set<LockableControl> {
  if (!preset?.locked) return new Set();
  return new Set(preset.lockedControls ?? ALL_LOCKABLE_CONTROLS);
}

function ViewFullMapLink() {
  return (
    <Link
      to="/"
      className="flex items-center gap-1.5 text-white/70 hover:text-white text-sm font-medium transition-colors px-2 py-1 rounded hover:bg-white/10"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
      </svg>
      View full map
    </Link>
  );
}

interface AppProps {
  preset?: Preset | null;
}

export default function App({ preset = null }: AppProps) {
  return <AppShell preset={preset} />;
}

/**
 * Outer shell: owns sidebar state and renders MapContainer.
 * Cannot call useMap() — it's the parent of MapContext.Provider.
 * Uses a ref to bridge the search callback to the inner content.
 */
function AppShell({ preset }: { preset: Preset | null }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const placeSelectedRef = useRef<(result: GeocodingResult) => void>(() => {});
  const location = useLocation();
  const onPresetRoute = location.pathname.startsWith('/view/');

  const lockedSet = useMemo(() => computeLockedSet(preset), [preset]);
  const layersLocked = lockedSet.has('layers');
  const searchLocked = lockedSet.has('search');

  const headerEl = (
    <Header
      onToggleSidebar={() => setSidebarOpen(s => !s)}
      sidebarOpen={sidebarOpen}
      hideSidebarToggle={layersLocked}
      searchBar={
        searchLocked ? undefined : (
          <AddressSearch
            onPlaceSelected={(r) => placeSelectedRef.current(r)}
            isSearching={false}
          />
        )
      }
      extraAction={onPresetRoute ? <ViewFullMapLink /> : undefined}
    />
  );

  return (
    <MapContainer header={headerEl} initialView={preset?.initialView}>
      <AppContent
        sidebarOpen={sidebarOpen}
        placeSelectedRef={placeSelectedRef}
        preset={preset}
        layersLocked={layersLocked}
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
  preset: Preset | null;
  layersLocked: boolean;
}

function AppContent({ sidebarOpen, placeSelectedRef, preset, layersLocked }: AppContentProps) {
  const { map } = useMap();
  const { layers, toggleLayer, setAllVisible, setLayerOpacity, setDynamicRasterTileUrl, setLayerDateRange } = useLayers(map, preset?.layers);

  const [searchCenter, setSearchCenter] = useState<{ lat: number; lng: number } | null>(null);
  const { content: siteContent } = useSiteContent();

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

      <FeaturePopup layers={layers} propertyClick={preset?.features.propertyClick ?? true} />
      <ForestLossPopup layers={layers} />
      <DistAlertPopup layers={layers} />

      {/* Admin-editable welcome box (only on the main landing view, not preset embeds) */}
      {!preset && <LandingIntro html={siteContent.landing_intro.html} />}

      {!layersLocked && (
        <Sidebar open={sidebarOpen}>
          <LayerControls
            layers={layers}
            onToggleLayer={toggleLayer}
            onSetAllVisible={setAllVisible}
            onSetLayerOpacity={setLayerOpacity}
            onSetDynamicTileUrl={setDynamicRasterTileUrl}
            onSetLayerDateRange={setLayerDateRange}
          />
        </Sidebar>
      )}
    </>
  );
}
