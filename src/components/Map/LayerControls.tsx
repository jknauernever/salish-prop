import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { LayerState } from '../../types';
import { useCategoryTree, flattenCategoryIds, type CategoryNode } from '../../services/categoryTree';
import { Toggle } from '../common/Toggle';
import { Badge } from '../common/Badge';
import { LoadingSpinner } from '../common/LoadingState';

interface LayerControlsProps {
  layers: LayerState[];
  onToggleLayer: (layerId: string) => void;
  onSetAllVisible: (layerIds: string[], visible: boolean) => void;
  onSetLayerOpacity?: (layerId: string, opacity: number) => void;
  onSetDynamicTileUrl?: (layerId: string, tileUrl: string) => void;
}

export function LayerControls({ layers, onToggleLayer, onSetAllVisible, onSetLayerOpacity, onSetDynamicTileUrl }: LayerControlsProps) {
  const { tree } = useCategoryTree();
  const layersById = useMemo(() => {
    const map = new Map<string, LayerState>();
    for (const l of layers) map.set(l.config.id, l);
    return map;
  }, [layers]);

  const allIds = useMemo(() => flattenCategoryIds(tree.tree), [tree]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setCollapsed(prev => {
      const next = { ...prev };
      for (const id of allIds) {
        if (!(id in next)) next[id] = true;
      }
      return next;
    });
  }, [allIds]);

  const toggleCollapsed = (id: string) => {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  };

  function renderNode(node: CategoryNode, depth: number): React.ReactNode {
    const isCollapsed = !!collapsed[node.id];

    // Resolve assigned layer ids to LayerState entries; skip any unknown ids.
    const groupLayers = node.layers
      .map(id => layersById.get(id))
      .filter((l): l is LayerState => !!l);

    const hasOwnContent = groupLayers.length > 0;
    const hasChildren = node.children.length > 0;
    if (!hasOwnContent && !hasChildren) return null;

    const activeLayers = groupLayers.filter(l => !l.config.placeholder);
    const allVisible = activeLayers.length > 0 && activeLayers.every(l => l.visible);
    const noneVisible = activeLayers.every(l => !l.visible);

    return (
      <div key={node.id} className="mb-3" style={depth > 0 ? { marginLeft: 12 } : undefined}>
        <div className="flex items-center justify-between mb-1">
          <button
            onClick={() => toggleCollapsed(node.id)}
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
              {node.label}
            </h3>
          </button>
          {!isCollapsed && activeLayers.length > 1 && (
            <button
              onClick={() => onSetAllVisible(node.layers, noneVisible || !allVisible)}
              className="text-xs text-ocean-blue hover:text-ocean-blue-light transition-colors"
            >
              {allVisible ? 'Hide all' : 'Show all'}
            </button>
          )}
        </div>

        {!isCollapsed && (
          <>
            {groupLayers.length > 0 && (
              <div className="space-y-1">
                {groupLayers.map(layer => (
                  <LayerRow
                    key={`${node.id}-${layer.config.id}`}
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
            {node.children.map(child => renderNode(child, depth + 1))}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="text-sm font-semibold text-slate-blue uppercase tracking-wider mb-4">
        Data Layers
      </h2>
      {tree.tree.map(node => renderNode(node, 0))}
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
  const hasInfo = !!config.standardMessage || !!config.sourceUrl;
  const [showInfo, setShowInfo] = useState(false);

  // For dynamic-raster layers with multiple visualization modes, track the
  // selected mode here so the legend and the tile fetcher both see it.
  const [vizMode, setVizMode] = useState<string>(
    () => config.visualizationModes?.[0]?.id ?? ''
  );
  const activeMode = config.visualizationModes?.find(m => m.id === vizMode);
  const legend = activeMode?.legend ?? config.legend;

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
              backgroundColor: (config.style.fillOpacity ?? 0) > 0
                ? config.style.fillColor ?? config.style.strokeColor
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

        {/* Info button */}
        {hasInfo && !isPlaceholder && (
          <button
            type="button"
            onClick={() => setShowInfo(v => !v)}
            aria-label={showInfo ? 'Hide layer info' : 'Show layer info'}
            aria-expanded={showInfo}
            className={`shrink-0 w-4 h-4 inline-flex items-center justify-center rounded-full border text-[10px] font-semibold transition-colors ${
              showInfo
                ? 'bg-deep-teal text-white border-deep-teal'
                : 'bg-white text-slate-blue/50 border-slate-blue/30 hover:text-slate-blue hover:border-slate-blue/60'
            }`}
          >
            i
          </button>
        )}

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

      {/* Info panel */}
      {showInfo && hasInfo && (
        <div className="ml-5 mr-2 mb-1 px-2.5 py-2 bg-fog-gray/60 border border-fog-gray-dark/40 rounded text-xs leading-relaxed text-slate-blue/80">
          {config.standardMessage && <p className="m-0">{config.standardMessage}</p>}
          {config.sourceUrl && (
            <p className="m-0 mt-1.5">
              <a
                href={config.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ocean-blue hover:text-ocean-blue-light underline"
              >
                Learn more about this dataset &rarr;
              </a>
            </p>
          )}
        </div>
      )}

      {/* Color-ramp legend (e.g. forest-loss year palette) */}
      {visible && loaded && legend?.type === 'gradient' && (
        <div className="ml-5 mr-2 mb-1.5 mt-0.5">
          <div
            className="h-2 rounded"
            style={{
              backgroundImage: `linear-gradient(to right, ${legend.colors.join(', ')})`,
            }}
            aria-hidden="true"
          />
          <div className="flex justify-between mt-0.5">
            <span className="text-[10px] text-slate-blue/50">{legend.minLabel}</span>
            <span className="text-[10px] text-slate-blue/50">{legend.maxLabel}</span>
          </div>
        </div>
      )}

      {/* Visualization-mode segmented toggle */}
      {isDynamic && visible && loaded && config.visualizationModes && config.visualizationModes.length > 1 && (
        <div className="ml-5 mr-2 mb-1.5 flex gap-0.5 rounded-md bg-fog-gray/60 p-0.5">
          {config.visualizationModes.map(mode => {
            const active = mode.id === vizMode;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => setVizMode(mode.id)}
                className={`flex-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-white text-slate-blue shadow-sm'
                    : 'text-slate-blue/60 hover:text-slate-blue'
                }`}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
      )}

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

      {/* Tile URL fetcher for dynamic raster layers */}
      {isDynamic && visible && loaded && onSetDynamicTileUrl && (
        config.visualizationModes && config.visualizationModes.length > 0 ? (
          <ModalTileFetcher
            apiEndpoint={config.apiEndpoint ?? ''}
            mode={vizMode}
            onTileUrl={onSetDynamicTileUrl}
          />
        ) : config.hideDateRange ? (
          <StaticTileFetcher
            apiEndpoint={config.apiEndpoint ?? ''}
            onTileUrl={onSetDynamicTileUrl}
          />
        ) : (
          <DynamicRasterDatePicker
            apiEndpoint={config.apiEndpoint ?? ''}
            onTileUrl={onSetDynamicTileUrl}
          />
        )
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

/**
 * Headless fetcher for dynamic-raster layers that don't need a date picker
 * (e.g. cumulative datasets like Hansen forest loss). Fires the apiEndpoint
 * once when the layer becomes visible, hands the resulting tileUrl back.
 */
function StaticTileFetcher({ apiEndpoint, onTileUrl }: {
  apiEndpoint: string;
  onTileUrl: (tileUrl: string) => void;
}) {
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (!apiEndpoint || fetchedRef.current) return;
    fetchedRef.current = true;
    fetch(apiEndpoint)
      .then(res => res.json())
      .then(data => {
        if (data?.tileUrl) onTileUrl(data.tileUrl);
      })
      .catch(err => {
        console.error('Failed to fetch tile URL from', apiEndpoint, err);
        fetchedRef.current = false; // allow retry on next mount
      });
  }, [apiEndpoint, onTileUrl]);
  return null;
}

/**
 * Headless fetcher for dynamic-raster layers with multiple visualization
 * modes (e.g. OPERA DIST-ALERT: recency / status / severity). Re-fetches the
 * tile URL whenever `mode` changes and passes the result to `onTileUrl`.
 */
function ModalTileFetcher({ apiEndpoint, mode, onTileUrl }: {
  apiEndpoint: string;
  mode: string;
  onTileUrl: (tileUrl: string) => void;
}) {
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Hold the latest onTileUrl in a ref so the fetch effect doesn't re-run
  // every time the parent passes a new callback identity (which would otherwise
  // turn the first-fetch success into an infinite loop of re-fetches).
  const onTileUrlRef = useRef(onTileUrl);
  useEffect(() => { onTileUrlRef.current = onTileUrl; }, [onTileUrl]);

  useEffect(() => {
    if (!apiEndpoint || !mode) return;
    let cancelled = false;
    setFetching(true);
    setFetchError(null);
    fetch(`${apiEndpoint}?mode=${encodeURIComponent(mode)}`)
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then(data => {
        if (cancelled) return;
        if (data?.tileUrl) {
          onTileUrlRef.current(data.tileUrl);
        } else {
          throw new Error('No tileUrl in response');
        }
      })
      .catch(err => {
        if (cancelled) return;
        setFetchError(err instanceof Error ? err.message : 'Failed to fetch tiles');
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => { cancelled = true; };
  }, [apiEndpoint, mode]);

  if (!fetching && !fetchError) return null;
  return (
    <div className="ml-5 px-2 pb-2">
      {fetching && (
        <div className="flex items-center gap-1.5">
          <LoadingSpinner size="sm" />
          <span className="text-xs text-slate-blue/50">Loading {mode}…</span>
        </div>
      )}
      {fetchError && (
        <p className="text-xs text-red-500">{fetchError}</p>
      )}
    </div>
  );
}

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
