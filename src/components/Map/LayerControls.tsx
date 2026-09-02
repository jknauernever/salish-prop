import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { LayerState, DateRange } from '../../types';
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
  onSetLayerDateRange?: (layerId: string, dateRange: DateRange) => void;
  onSetLayerUi?: (layerId: string, patch: { vizMode?: string; season?: string }) => void;
}

export function LayerControls({ layers, onToggleLayer, onSetAllVisible, onSetLayerOpacity, onSetDynamicTileUrl, onSetLayerDateRange, onSetLayerUi }: LayerControlsProps) {
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
                    onSetDateRange={
                      layer.config.source === 'observations:multi' && onSetLayerDateRange
                        ? (range: DateRange) => onSetLayerDateRange(layer.config.id, range)
                        : undefined
                    }
                    onSetUi={
                      onSetLayerUi
                        ? (patch) => onSetLayerUi(layer.config.id, patch)
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

function LayerRow({ layer, onToggle, onOpacityChange, onSetDynamicTileUrl, onSetDateRange, onSetUi }: {
  layer: LayerState;
  onToggle: () => void;
  onOpacityChange?: (opacity: number) => void;
  onSetDynamicTileUrl?: (tileUrl: string) => void;
  onSetDateRange?: (range: DateRange) => void;
  onSetUi?: (patch: { vizMode?: string; season?: string }) => void;
}) {
  const { config, visible, loaded, loading, error, featureCount, opacity } = layer;
  const isPlaceholder = config.placeholder;
  const isRaster = config.layerType === 'raster' || config.layerType === 'dynamic-raster';
  const isDynamic = config.layerType === 'dynamic-raster';
  const hasInfo = !!config.standardMessage || !!config.sourceUrl || !!config.sourceCredit;
  const [showInfo, setShowInfo] = useState(false);

  // For dynamic-raster layers with multiple visualization modes, the selected
  // mode lives on the layer state (so it can round-trip through the URL);
  // the legend and the tile fetcher both read it from there.
  const vizMode = layer.vizMode ?? config.visualizationModes?.[0]?.id ?? '';
  const setVizMode = (id: string) => onSetUi?.({ vizMode: id });
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
          <p className="m-0 mb-1 font-semibold text-slate-blue">{config.name}</p>
          {config.standardMessage && <p className="m-0">{config.standardMessage}</p>}
          {config.sourceCredit && (
            <p className="m-0 mt-1.5 text-slate-blue/60">
              <span className="font-semibold">Source:</span> {config.sourceCredit}
            </p>
          )}
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

      {/* Category legend (vector layers styled by attribute) */}
      {visible && loaded && legend?.type === 'categories' && (
        <div className="ml-5 mr-2 mb-1.5 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
          {legend.items.map(item => (
            <span key={item.label} className="inline-flex items-center gap-1 text-[10px] text-slate-blue/60">
              <span
                aria-hidden="true"
                className={
                  item.shape === 'point'
                    ? 'inline-block w-2 h-2 rounded-full'
                    : item.shape === 'fill'
                      ? 'inline-block w-3 h-2 rounded-sm'
                      : 'inline-block w-3 h-0.5 rounded'
                }
                style={{ backgroundColor: item.color }}
              />
              {item.label}
            </span>
          ))}
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

      {/* Dual-handle date-range slider for multi-source observation layers. */}
      {visible && loaded && onSetDateRange && layer.geojsonData && (
        <TimeRangeSlider
          features={layer.geojsonData.features}
          value={layer.dateRange ?? { start: null, end: null }}
          onChange={onSetDateRange}
        />
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
            initialSeason={layer.season}
            onSeasonChange={onSetUi ? (slug) => onSetUi({ season: slug }) : undefined}
          />
        )
      )}
    </div>
  );
}

// Seasonal time steps for Sentinel-2 (Spring 2017 → Fall 2025)
interface SeasonStep {
  label: string;
  /** URL-safe id, e.g. "summer-2024" */
  slug: string;
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
        slug: `${name.toLowerCase()}-${year}`,
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

const DAY_MS = 86400000;

function dayToDate(minDate: string, day: number): string {
  const d = new Date(new Date(`${minDate}T12:00:00`).getTime() + day * DAY_MS);
  return d.toISOString().slice(0, 10);
}

function dateToDay(minDate: string, dateStr: string): number {
  return Math.round(
    (new Date(`${dateStr}T12:00:00`).getTime() - new Date(`${minDate}T12:00:00`).getTime()) /
      DAY_MS,
  );
}

function fmtDate(dateStr: string): string {
  try {
    return new Date(`${dateStr}T12:00:00`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/**
 * Dual-handle date-range slider with preset buttons. Mirrors EarthAtlas's
 * TimeSlider (see /Users/jknauer/Projects/earthatlas/src/explore/components/
 * TimeSlider.jsx). The min/max bounds come from the feature collection's
 * actual obsDate values, not a fixed window — so a layer fetched with a
 * year of data shows a year-wide slider.
 *
 * Filtering is client-side: all observations are already in `features`;
 * onChange just updates the date constraints used by the Data layer's
 * style function in useLayers.
 */
function TimeRangeSlider({ features, value, onChange }: {
  features: GeoJSON.Feature[];
  value: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const { minDate, maxDate, totalDays } = useMemo(() => {
    if (features.length === 0) return { minDate: null, maxDate: null, totalDays: 0 };
    let min: string | null = null;
    let max: string | null = null;
    for (const f of features) {
      const d = f.properties?.obsDate as string | undefined;
      if (!d) continue;
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
    }
    if (!min || !max) return { minDate: null, maxDate: null, totalDays: 0 };
    const days = Math.round(
      (new Date(`${max}T12:00:00`).getTime() - new Date(`${min}T12:00:00`).getTime()) / DAY_MS,
    );
    return { minDate: min, maxDate: max, totalDays: days };
  }, [features]);

  const loDay = value.start && minDate ? dateToDay(minDate, value.start) : 0;
  const hiDay = value.end && minDate ? dateToDay(minDate, value.end) : totalDays;
  const loPct = totalDays > 0 ? (loDay / totalDays) * 100 : 0;
  const hiPct = totalDays > 0 ? (hiDay / totalDays) * 100 : 100;

  const visibleCount = useMemo(() => {
    if (!minDate) return features.length;
    const startMs = value.start
      ? new Date(`${value.start}T00:00:00`).getTime()
      : -Infinity;
    const endMs = value.end ? new Date(`${value.end}T23:59:59`).getTime() : Infinity;
    let n = 0;
    for (const f of features) {
      const t = Number(f.properties?.obsTime ?? 0);
      if (t >= startMs && t <= endMs) n++;
    }
    return n;
  }, [features, minDate, value.start, value.end]);

  const handleLo = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!minDate) return;
      const day = Math.min(parseInt(e.target.value, 10), hiDay - 1);
      onChange({ ...value, start: day <= 0 ? null : dayToDate(minDate, day) });
    },
    [hiDay, minDate, onChange, value],
  );
  const handleHi = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!minDate) return;
      const day = Math.max(parseInt(e.target.value, 10), loDay + 1);
      onChange({ ...value, end: day >= totalDays ? null : dayToDate(minDate, day) });
    },
    [loDay, totalDays, minDate, onChange, value],
  );

  const applyPreset = useCallback(
    (days: number) => {
      if (!maxDate || !minDate) return;
      const end = new Date(`${maxDate}T12:00:00`);
      const start = new Date(end.getTime() - days * DAY_MS).toISOString().slice(0, 10);
      const clamped = start < minDate ? null : start;
      onChange({ start: clamped, end: null });
    },
    [maxDate, minDate, onChange],
  );

  const isActivePreset = useCallback(
    (days: number) => {
      if (!value.start || value.end || !maxDate) return false;
      const expected = new Date(new Date(`${maxDate}T12:00:00`).getTime() - days * DAY_MS)
        .toISOString()
        .slice(0, 10);
      return value.start === expected;
    },
    [value.start, value.end, maxDate],
  );

  if (!minDate || !maxDate || totalDays < 1) {
    return (
      <p className="ml-5 px-2 pb-2 text-[10px] text-slate-blue/50">
        Not enough date range to filter.
      </p>
    );
  }

  const startLabel = fmtDate(value.start ?? minDate);
  const endLabel = fmtDate(value.end ?? maxDate);

  return (
    <div className="ml-5 mr-2 mb-2 px-2 pb-1 space-y-1">
      <div className="flex items-center justify-between text-[11px] text-slate-blue/70">
        <span>{startLabel}</span>
        <span>→</span>
        <span>{endLabel}</span>
      </div>

      {/* Track + dual handles */}
      <div className="relative h-5">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded bg-fog-gray" />
        <div
          className="absolute top-1/2 -translate-y-1/2 h-1 rounded bg-ocean-blue"
          style={{ left: `${loPct}%`, right: `${100 - hiPct}%` }}
        />
        <input
          type="range"
          min={0}
          max={totalDays}
          step={1}
          value={loDay}
          onChange={handleLo}
          aria-label="Range start"
          className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-moz-range-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-ocean-blue [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-ocean-blue [&::-moz-range-thumb]:cursor-pointer"
        />
        <input
          type="range"
          min={0}
          max={totalDays}
          step={1}
          value={hiDay}
          onChange={handleHi}
          aria-label="Range end"
          className="absolute inset-0 w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-moz-range-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-ocean-blue [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-ocean-blue [&::-moz-range-thumb]:cursor-pointer"
        />
      </div>

      {/* Presets — match EarthAtlas exactly, plus "Last year" since we fetch a year by default. */}
      <div className="flex flex-wrap gap-1">
        {[
          { label: '24h', days: 1 },
          { label: 'Week', days: 7 },
          { label: 'Month', days: 30 },
          { label: 'Year', days: 365 },
        ].map(({ label, days }) => {
          const active = isActivePreset(days);
          return (
            <button
              key={label}
              type="button"
              onClick={() => applyPreset(days)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                active
                  ? 'bg-ocean-blue text-white'
                  : 'bg-fog-gray/60 text-slate-blue/70 hover:bg-fog-gray'
              }`}
            >
              {label}
            </button>
          );
        })}
        {(value.start || value.end) && (
          <button
            type="button"
            onClick={() => onChange({ start: null, end: null })}
            className="px-2 py-0.5 rounded text-[11px] font-medium text-slate-blue/60 hover:text-slate-blue underline-offset-2 hover:underline"
          >
            All
          </button>
        )}
      </div>

      <p className="text-[10px] text-slate-blue/50">
        Showing {visibleCount.toLocaleString()} of {features.length.toLocaleString()} observations
      </p>
    </div>
  );
}

function DynamicRasterDatePicker({ apiEndpoint, onTileUrl, initialSeason, onSeasonChange }: {
  apiEndpoint: string;
  onTileUrl: (tileUrl: string) => void;
  /** Initial season slug (from the URL); falls back to Summer 2024. */
  initialSeason?: string;
  onSeasonChange?: (slug: string) => void;
}) {
  const [index, setIndex] = useState(() => {
    const i = initialSeason ? SEASONS.findIndex(s => s.slug === initialSeason) : -1;
    return i >= 0 ? i : DEFAULT_INDEX;
  });
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loadedIndex, setLoadedIndex] = useState(-1);

  const onSeasonChangeRef = useRef(onSeasonChange);
  useEffect(() => { onSeasonChangeRef.current = onSeasonChange; }, [onSeasonChange]);

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
        onSeasonChangeRef.current?.(season.slug);
      } else {
        throw new Error('No tileUrl in response');
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Failed to fetch tiles');
    } finally {
      setFetching(false);
    }
  }, [apiEndpoint, onTileUrl]);

  // Auto-fetch the initial season on mount (URL-provided or the default)
  useEffect(() => {
    if (loadedIndex === -1 && apiEndpoint) {
      fetchTiles(index);
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
