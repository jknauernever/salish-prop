import { useState, useEffect, useCallback } from 'react';
import type { LayerState } from '../../types';
import { categoryLabels, categoryOrder } from '../../config/layers';
import { Toggle } from '../common/Toggle';
import { Badge } from '../common/Badge';
import { LoadingSpinner } from '../common/LoadingState';

interface LayerControlsProps {
  layers: LayerState[];
  onToggleLayer: (layerId: string) => void;
  onSetAllVisible: (category: string, visible: boolean) => void;
  onSetLayerOpacity?: (layerId: string, opacity: number) => void;
  onSetDynamicTileUrl?: (layerId: string, tileUrl: string) => void;
}

export function LayerControls({ layers, onToggleLayer, onSetAllVisible, onSetLayerOpacity, onSetDynamicTileUrl }: LayerControlsProps) {
  // All categories start collapsed
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(categoryOrder.map(cat => [cat, true]))
  );

  const toggleCollapsed = (category: string) => {
    setCollapsed(prev => ({ ...prev, [category]: !prev[category] }));
  };

  const groupedLayers = categoryOrder
    .map(cat => ({
      category: cat,
      label: categoryLabels[cat] || cat,
      layers: layers.filter(l => l.config.category === cat),
    }))
    .filter(g => g.layers.length > 0);

  return (
    <div className="p-4">
      <h2 className="text-sm font-semibold text-slate-blue uppercase tracking-wider mb-4">
        Data Layers
      </h2>

      {groupedLayers.map(group => {
        const activeLayers = group.layers.filter(l => !l.config.placeholder);
        const allVisible = activeLayers.length > 0 && activeLayers.every(l => l.visible);
        const noneVisible = activeLayers.every(l => !l.visible);
        const isCollapsed = !!collapsed[group.category];

        return (
          <div key={group.category} className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <button
                onClick={() => toggleCollapsed(group.category)}
                className="flex items-center gap-1.5 group cursor-pointer"
              >
                <svg
                  className={`w-3 h-3 text-slate-blue/50 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}
                  viewBox="0 0 12 12"
                  fill="currentColor"
                >
                  <path d="M4 2 L9 6 L4 10 Z" />
                </svg>
                <h3 className="text-xs font-semibold text-slate-blue/70 uppercase tracking-wider group-hover:text-slate-blue transition-colors">
                  {group.label}
                </h3>
              </button>
              {!isCollapsed && activeLayers.length > 1 && (
                <button
                  onClick={() => onSetAllVisible(group.category, noneVisible || !allVisible)}
                  className="text-xs text-ocean-blue hover:text-ocean-blue-light transition-colors"
                >
                  {allVisible ? 'Hide all' : 'Show all'}
                </button>
              )}
            </div>

            {!isCollapsed && (
              <div className="space-y-1">
                {group.layers.map(layer => (
                  <LayerRow
                    key={layer.config.id}
                    layer={layer}
                    onToggle={() => onToggleLayer(layer.config.id)}
                    onOpacityChange={
                      (layer.config.layerType === 'raster' || layer.config.layerType === 'dynamic-raster') && onSetLayerOpacity
                        ? (opacity: number) => onSetLayerOpacity(layer.config.id, opacity)
                        : undefined
                    }
                    onSetDynamicTileUrl={
                      layer.config.layerType === 'dynamic-raster' && onSetDynamicTileUrl
                        ? (tileUrl: string) => onSetDynamicTileUrl(layer.config.id, tileUrl)
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LayerRow({ layer, onToggle, onOpacityChange, onSetDynamicTileUrl }: {
  layer: LayerState;
  onToggle: () => void;
  onOpacityChange?: (opacity: number) => void;
  onSetDynamicTileUrl?: (tileUrl: string) => void;
}) {
  const { config, visible, loaded, loading, error, featureCount, opacity } = layer;
  const isPlaceholder = config.placeholder;
  const isRaster = config.layerType === 'raster' || config.layerType === 'dynamic-raster';
  const isDynamic = config.layerType === 'dynamic-raster';

  return (
    <div>
      <div
        className={`
          flex items-center gap-2 px-2 py-1 rounded-md transition-colors
          ${isPlaceholder ? 'opacity-50' : 'hover:bg-fog-gray/50'}
        `}
      >
        {/* Color swatch or marker icon */}
        {config.markerIcon ? (
          <img
            src={config.markerIcon}
            alt=""
            className="w-5 h-5 shrink-0"
          />
        ) : (
          <div
            className="w-4 h-4 rounded-sm shrink-0 border border-black/10"
            style={{
              backgroundColor: config.style.fillOpacity > 0
                ? config.style.fillColor
                : config.style.strokeColor,
            }}
          />
        )}

        {/* Name and status */}
        <div className="flex-1 min-w-0">
          <span className={`text-xs leading-tight ${isPlaceholder ? 'text-slate-blue/40' : 'text-slate-blue'}`}>
            {config.name}
          </span>
          {isPlaceholder && (
            <span className="ml-1.5 text-xs text-slate-blue/30 italic">coming soon</span>
          )}
          {error && !isPlaceholder && (
            <span className="ml-1.5 text-xs text-red-500">{error}</span>
          )}
        </div>

        {/* Loading indicator */}
        {loading && <LoadingSpinner size="sm" />}

        {/* Feature count */}
        {loaded && featureCount > 0 && (
          <Badge count={featureCount} variant={visible ? 'default' : 'muted'} />
        )}

        {/* Toggle */}
        <Toggle
          enabled={visible}
          onChange={onToggle}
          disabled={isPlaceholder || (!loaded && !loading)}
        />
      </div>

      {/* Opacity slider for raster layers */}
      {isRaster && visible && loaded && onOpacityChange && (
        <div className="flex items-center gap-2 px-2 pb-1.5 ml-5">
          <span className="text-xs text-slate-blue/50 shrink-0">Opacity</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round((opacity ?? 0.7) * 100)}
            onChange={e => onOpacityChange(Number(e.target.value) / 100)}
            className="flex-1 h-1 accent-ocean-blue cursor-pointer"
          />
          <span className="text-xs text-slate-blue/50 w-8 text-right">
            {Math.round((opacity ?? 0.7) * 100)}%
          </span>
        </div>
      )}

      {/* Date range picker for dynamic raster layers */}
      {isDynamic && visible && loaded && onSetDynamicTileUrl && (
        <DynamicRasterDatePicker
          apiEndpoint={config.apiEndpoint ?? ''}
          onTileUrl={onSetDynamicTileUrl}
        />
      )}
    </div>
  );
}

// Seasonal time steps for Sentinel-2 (Spring 2017 → Fall 2025)
interface SeasonStep {
  label: string;
  start: string;
  end: string;
}

const SEASONS: SeasonStep[] = (() => {
  const steps: SeasonStep[] = [];
  const defs: [string, string, string][] = [
    ['Spring', '03-01', '05-31'],
    ['Summer', '06-01', '08-31'],
    ['Fall', '09-01', '11-30'],
  ];
  for (let year = 2017; year <= 2025; year++) {
    for (const [name, startMD, endMD] of defs) {
      steps.push({
        label: `${name} ${year}`,
        start: `${year}-${startMD}`,
        end: `${year}-${endMD}`,
      });
    }
  }
  return steps;
})();

// Default to Summer 2024
const DEFAULT_INDEX = SEASONS.findIndex(s => s.label === 'Summer 2024');

function DynamicRasterDatePicker({ apiEndpoint, onTileUrl }: {
  apiEndpoint: string;
  onTileUrl: (tileUrl: string) => void;
}) {
  const [index, setIndex] = useState(DEFAULT_INDEX);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loadedIndex, setLoadedIndex] = useState(-1);

  const fetchTiles = useCallback(async (seasonIndex: number) => {
    if (!apiEndpoint) {
      setFetchError('API endpoint not configured');
      return;
    }
    const season = SEASONS[seasonIndex];
    if (!season) return;
    setFetching(true);
    setFetchError(null);
    try {
      const url = `${apiEndpoint}?start=${encodeURIComponent(season.start)}&end=${encodeURIComponent(season.end)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.tileUrl) {
        onTileUrl(data.tileUrl);
        setLoadedIndex(seasonIndex);
      } else {
        throw new Error('No tileUrl in response');
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Failed to fetch tiles');
    } finally {
      setFetching(false);
    }
  }, [apiEndpoint, onTileUrl]);

  // Auto-fetch default season on mount
  useEffect(() => {
    if (loadedIndex === -1 && apiEndpoint) {
      fetchTiles(DEFAULT_INDEX);
    }
  }, [apiEndpoint]); // eslint-disable-line react-hooks/exhaustive-deps

  const season = SEASONS[index];

  return (
    <div className="ml-5 px-2 pb-2 space-y-1">
      {/* Season label */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-blue/50">Time</span>
        <span className="text-xs font-semibold text-slate-blue">{season?.label}</span>
      </div>

      {/* Slider — fetches only on release */}
      <input
        type="range"
        min={0}
        max={SEASONS.length - 1}
        step={1}
        value={index}
        onChange={e => setIndex(Number(e.target.value))}
        onPointerUp={() => { if (index !== loadedIndex) fetchTiles(index); }}
        onKeyUp={() => { if (index !== loadedIndex) fetchTiles(index); }}
        disabled={fetching}
        className="w-full h-1 accent-ocean-blue cursor-pointer disabled:opacity-50"
      />

      {/* Year ticks */}
      <div className="flex justify-between px-0.5">
        <span className="text-[9px] text-slate-blue/30">2017</span>
        <span className="text-[9px] text-slate-blue/30">2019</span>
        <span className="text-[9px] text-slate-blue/30">2021</span>
        <span className="text-[9px] text-slate-blue/30">2023</span>
        <span className="text-[9px] text-slate-blue/30">2025</span>
      </div>

      {/* Status */}
      {fetching && (
        <div className="flex items-center gap-1.5">
          <LoadingSpinner size="sm" />
          <span className="text-xs text-slate-blue/50">Computing satellite composite...</span>
        </div>
      )}
      {fetchError && (
        <p className="text-xs text-red-500">{fetchError}</p>
      )}
    </div>
  );
}
