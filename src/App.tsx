import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MapContainer } from './components/Map/MapContainer';
import { LayerControls } from './components/Map/LayerControls';
import { FeaturePopup, PARCEL_SEARCH_EVENT, OPEN_PARCEL_POPUP_EVENT, PARCEL_POPUP_STATE_EVENT } from './components/Map/FeaturePopup';
import { ForestLossPopup } from './components/Map/ForestLossPopup';
import { DistAlertPopup } from './components/Map/DistAlertPopup';
import type { ParcelSearchDetail, OpenParcelPopupDetail, ParcelPopupStateDetail } from './components/Map/FeaturePopup';
import { RadiusOverlay } from './components/Map/RadiusOverlay';
import { LandingIntro } from './components/Map/LandingIntro';
import { MapLegend } from './components/Map/MapLegend';
import { useLayersInView } from './hooks/useLayersInView';
import { preloadFriendsContent } from './services/friendsContent';
import { AddressSearch } from './components/Search/AddressSearch';
import { Header } from './components/Layout/Header';
import { Sidebar } from './components/Layout/Sidebar';
import { useMap } from './hooks/useMap';
import { useLayers } from './hooks/useLayers';
import { useSiteContent } from './services/siteContent';
import { initialUrlState, setUrlParams, fmtLatLng, fmtPairs } from './services/urlState';
import { layerConfigs } from './config/layers';
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
  const [sidebarOpen, setSidebarOpen] = useState(initialUrlState.sidebar);
  const placeSelectedRef = useRef<(result: GeocodingResult) => void>(() => {});
  const location = useLocation();
  const onPresetRoute = location.pathname.startsWith('/view/');

  const lockedSet = useMemo(() => computeLockedSet(preset), [preset]);
  const layersLocked = lockedSet.has('layers');
  const searchLocked = lockedSet.has('search');

  useEffect(() => {
    setUrlParams({ sb: sidebarOpen ? '1' : null });
  }, [sidebarOpen]);

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
    <MapContainer
      header={headerEl}
      initialView={initialUrlState.view ?? preset?.initialView}
      initialMapTypeId={initialUrlState.basemap ?? undefined}
    >
      <AppContent
        sidebarOpen={sidebarOpen}
        onOpenSidebar={() => setSidebarOpen(true)}
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
  onOpenSidebar: () => void;
  placeSelectedRef: React.MutableRefObject<(result: GeocodingResult) => void>;
  preset: Preset | null;
  layersLocked: boolean;
}

function AppContent({ sidebarOpen, onOpenSidebar, placeSelectedRef, preset, layersLocked }: AppContentProps) {
  const { map, zoom } = useMap();
  const { layers, toggleLayer, setAllVisible, setLayerOpacity, setDynamicRasterTileUrl, setLayerDateRange, setLayerUi, zoomOverrides, setZoomOverride } =
    useLayers(map, initialUrlState.layers ?? preset?.layers, initialUrlState.layerUi);
  const layersInView = useLayersInView(map, layers, zoomOverrides);
  useEffect(() => { void preloadFriendsContent(); }, []);

  const [searchCenter, setSearchCenter] = useState<{ lat: number; lng: number } | null>(initialUrlState.search);
  const { content: siteContent } = useSiteContent();

  // --- URL mirroring: layer visibility + per-layer settings ---
  useEffect(() => {
    const visibleIds = layers.filter(l => l.visible && !l.config.placeholder).map(l => l.config.id);
    // Omit `l` when it matches the defaults (config, or the preset's list) —
    // keeps plain links short; the server treats "absent" the same way.
    const defaultIds = preset?.layers ?? layerConfigs.filter(c => c.visible && !c.placeholder).map(c => c.id);
    const isDefault =
      visibleIds.length === defaultIds.length && visibleIds.every(id => defaultIds.includes(id));
    const rasterIds = new Set(
      layers.filter(l => l.config.layerType === 'raster' || l.config.layerType === 'dynamic-raster').map(l => l.config.id),
    );
    setUrlParams({
      l: isDefault ? null : visibleIds.join(','),
      o: fmtPairs(
        layers
          .filter(l => rasterIds.has(l.config.id) && l.opacity != null && l.opacity !== (l.config.defaultOpacity ?? 0.7))
          .map(l => [l.config.id, String(Math.round((l.opacity ?? 0) * 100) / 100)]),
      ),
      m: fmtPairs(
        layers
          .filter(l => l.vizMode && l.vizMode !== l.config.visualizationModes?.[0]?.id)
          .map(l => [l.config.id, l.vizMode]),
      ),
      s: fmtPairs(layers.filter(l => l.season).map(l => [l.config.id, l.season])),
      d: fmtPairs(
        layers
          .filter(l => l.dateRange && (l.dateRange.start || l.dateRange.end))
          .map(l => [l.config.id, `${l.dateRange!.start ?? ''}..${l.dateRange!.end ?? ''}`]),
      ),
    });
  }, [layers, preset]);

  // --- URL mirroring: which parcel popup is open ---
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<ParcelPopupStateDetail>).detail;
      setUrlParams({ p: d ? fmtLatLng(d.lat, d.lng) : null });
    };
    window.addEventListener(PARCEL_POPUP_STATE_EVENT, handler);
    return () => window.removeEventListener(PARCEL_POPUP_STATE_EVENT, handler);
  }, []);

  // --- Restore a parcel popup from the URL once parcel data is available ---
  const restoredParcelRef = useRef(false);
  const parcelsLoaded = layers.some(l => l.config.id === 'tax-parcels' && l.loaded);
  useEffect(() => {
    const target = initialUrlState.parcel ?? initialUrlState.search;
    if (restoredParcelRef.current || !parcelsLoaded || !target) return;
    restoredParcelRef.current = true;
    window.dispatchEvent(new CustomEvent<OpenParcelPopupDetail>(OPEN_PARCEL_POPUP_EVENT, { detail: target }));
  }, [parcelsLoaded]);

  const handlePlaceSelected = useCallback((result: GeocodingResult) => {
    setSearchCenter({ lat: result.lat, lng: result.lng });
    setUrlParams({ q: fmtLatLng(result.lat, result.lng) });
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
      {!preset && <LandingIntro html={siteContent.landing_intro.html} defaultDismissed={initialUrlState.hasState} />}

      {/* Floating legend: only what's on the map, plus the door to the full picker */}
      {!layersLocked && !sidebarOpen && (
        <MapLegend layers={layers} onToggleLayer={toggleLayer} onExplore={onOpenSidebar} zoom={zoom} inView={layersInView} zoomOverrides={zoomOverrides} onSetZoomOverride={setZoomOverride} />
      )}

      {!layersLocked && (
        <Sidebar open={sidebarOpen}>
          <LayerControls
            layers={layers}
            onToggleLayer={toggleLayer}
            onSetAllVisible={setAllVisible}
            onSetLayerOpacity={setLayerOpacity}
            onSetDynamicTileUrl={setDynamicRasterTileUrl}
            onSetLayerDateRange={setLayerDateRange}
            onSetLayerUi={setLayerUi}
          />
        </Sidebar>
      )}
    </>
  );
}
