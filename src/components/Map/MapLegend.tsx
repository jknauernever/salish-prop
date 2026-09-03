import { useEffect, useState } from 'react';
import type { LayerConfig, LayerState } from '../../types';

interface MapLegendProps {
  layers: LayerState[];
  onToggleLayer: (layerId: string) => void;
  /** Opens the full dataset picker (the sidebar). */
  onExplore: () => void;
  /** Current map zoom, used to flag layers gated behind a minZoom. */
  zoom: number;
  /** Ids of visible layers that have something drawn inside the current map frame. */
  inView: Set<string>;
  /** Layers the user asked to see regardless of their minZoom. */
  zoomOverrides: Set<string>;
  onSetZoomOverride: (layerId: string, on: boolean) => void;
}

function hasInfo(config: LayerConfig): boolean {
  return !!config.standardMessage || !!config.sourceUrl || !!config.sourceCredit || !!config.description;
}

/** Small swatch that mirrors how the layer draws on the map. */
function Swatch({ config }: { config: LayerConfig }) {
  if (config.renderer === 'kelp-squiggle') {
    // Cream wash with the nautical kelp squiggle, as drawn by KelpOverlay
    return (
      <span className="inline-flex items-center justify-center w-4 h-3 rounded-sm shrink-0" style={{ background: '#FFF4CC', boxShadow: 'inset 0 0 0 1px #D9C87A' }}>
        <svg width="12" height="6" viewBox="0 0 12 6" aria-hidden="true">
          <path d="M0.5 3c1.5-2.5 3-2.5 4.5 0s3 2.5 4.5 0" fill="none" stroke="#B89A3A" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  if (config.markerIcon) {
    return <img src={config.markerIcon} alt="" className="w-4 h-[18px] shrink-0 object-contain" />;
  }
  if (config.layerType === 'raster' || config.layerType === 'dynamic-raster') {
    const g = config.legend?.type === 'gradient' ? config.legend : null;
    return (
      <span
        className="inline-block w-4 h-3 rounded-sm shrink-0 border border-black/10"
        style={{ background: g ? `linear-gradient(to right, ${g.colors.join(', ')})` : '#94A3B8' }}
      />
    );
  }
  const fill = (config.style.fillOpacity ?? 0) > 0;
  const color = fill ? (config.style.fillColor ?? config.style.strokeColor) : config.style.strokeColor;
  if (fill) {
    return (
      <span
        className="inline-block w-4 h-3 rounded-sm shrink-0"
        style={{ background: color, opacity: Math.max(0.5, config.style.fillOpacity ?? 1), boxShadow: `inset 0 0 0 1.5px ${config.style.strokeColor}` }}
      />
    );
  }
  return <span className="inline-block w-4 h-[3px] rounded shrink-0" style={{ background: color }} />;
}

/** Categorical legend chips (vector layers styled by attribute). */
function CategoryChips({ config, className = '' }: { config: LayerConfig; className?: string }) {
  const cat = config.legend?.type === 'categories' ? config.legend : null;
  if (!cat) return null;
  return (
    <div className={`flex flex-wrap gap-x-2.5 gap-y-0.5 ${className}`}>
      {cat.items.map(item => (
        <span key={item.label} className="inline-flex items-center gap-1 text-[10px] text-slate-blue/60">
          <span
            aria-hidden="true"
            className={item.shape === 'point' ? 'inline-block w-2 h-2 rounded-full' : item.shape === 'fill' ? 'inline-block w-3 h-2 rounded-sm' : 'inline-block w-3 h-0.5 rounded'}
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/** Inline "about this layer" block — same content as the sidebar's info panel. */
function LayerInfo({ config }: { config: LayerConfig }) {
  return (
    <div className="mt-1 ml-6 mr-1 px-2.5 py-2 bg-fog-gray/60 border border-fog-gray-dark/40 rounded text-[11px] leading-relaxed text-slate-blue/80">
      {config.standardMessage ? (
        <p className="m-0">{config.standardMessage}</p>
      ) : (
        config.description && <p className="m-0">{config.description}</p>
      )}
      {config.sourceCredit && (
        <p className="m-0 mt-1.5 text-slate-blue/60">
          <span className="font-semibold">Source:</span> {config.sourceCredit}
        </p>
      )}
      {config.sourceUrl && (
        <p className="m-0 mt-1.5">
          <a href={config.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-ocean-blue hover:text-ocean-blue-light underline">
            Learn more about this dataset &rarr;
          </a>
        </p>
      )}
    </div>
  );
}

/**
 * "How this is sourced" — one modal describing every dataset currently on
 * the map: what it shows, where it comes from, and its legend.
 */
function SourcingModal({ layers, zoom, onClose }: { layers: LayerState[]; zoom: number; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 bg-slate-blue/40 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sourcing-title"
        onClick={e => e.stopPropagation()}
        className="relative w-full max-w-2xl max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-4rem)] flex flex-col bg-white rounded-lg shadow-2xl border border-fog-gray-dark/40 text-slate-blue"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full text-slate-blue/50 hover:text-slate-blue hover:bg-fog-gray transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="px-6 pt-5 pb-3 border-b border-fog-gray-dark/40">
          <h2 id="sourcing-title" className="m-0 text-xl font-bold text-slate-blue">How this is sourced</h2>
        </div>

        <div className="px-6 py-4 overflow-y-auto text-sm leading-relaxed">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-deep-teal">What you're looking at</p>
          <p className="mt-1.5 mb-4 text-slate-blue/80">
            Each layer below comes from a published dataset — county GIS, Washington state agencies, federal satellite
            products, or field surveys by Friends of the San Juans and its partners. The map draws the data as its source
            published it and credits that source on every layer, with a link to the dataset where one is available. This
            list always matches what is on the map right now; turn layers on and off from the legend or the dataset picker.
          </p>

          <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wider text-deep-teal">
            The layers{layers.length > 0 ? ` · ${layers.length}` : ''}
          </p>
          {layers.length === 0 && (
            <p className="m-0 text-slate-blue/60">No data layers are turned on.</p>
          )}
          <ul className="m-0 p-0 list-none divide-y divide-fog-gray-dark/30">
            {layers.map(({ config }) => {
              const gated = config.minZoom != null && zoom < config.minZoom;
              return (
                <li key={config.id} className="py-3">
                  <div className="flex items-center gap-2">
                    <Swatch config={config} />
                    <span className="font-semibold text-slate-blue">{config.name}</span>
                    {gated && (
                      <span className="text-[10px] text-slate-blue/50">drawn at zoom {config.minZoom}+ — zoom in to see it</span>
                    )}
                  </div>
                  {(config.standardMessage || config.description) && (
                    <p className="m-0 mt-1 text-slate-blue/80">{config.standardMessage ?? config.description}</p>
                  )}
                  <CategoryChips config={config} className="mt-1.5" />
                  {(config.sourceCredit || config.sourceUrl) && (
                    <p className="m-0 mt-1.5 text-xs text-slate-blue/60">
                      {config.sourceCredit && (
                        <>
                          <span className="font-semibold">Source:</span> {config.sourceCredit}
                        </>
                      )}
                      {config.sourceUrl && (
                        <>
                          {config.sourceCredit && ' · '}
                          <a href={config.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-ocean-blue hover:text-ocean-blue-light underline">
                            View the dataset &#8599;
                          </a>
                        </>
                      )}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="px-6 py-3 border-t border-fog-gray-dark/40">
          <button
            type="button"
            onClick={onClose}
            className="w-full bg-slate-blue hover:bg-slate-blue-light text-white text-sm font-medium py-2 rounded-md transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Floating "what's on the map" legend. Lists only the layers that are
 * currently switched on, each with its swatch (or categorical legend), an
 * info button, a zoom hint when the layer is gated, and an off switch. The
 * footer opens the full dataset picker, and "How this is sourced" opens a
 * modal describing every visible dataset.
 */
export function MapLegend({ layers, onToggleLayer, onExplore, zoom, inView, zoomOverrides, onSetZoomOverride }: MapLegendProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  const [showSourcing, setShowSourcing] = useState(false);
  // Layers hidden from the legend row (click on the name) stay listed until ×
  const [kept, setKept] = useState<Set<string>>(() => new Set());
  const on = layers.filter(l => (l.visible || kept.has(l.config.id)) && !l.config.placeholder);
  const inViewCount = on.filter(l => l.visible && inView.has(l.config.id)).length;

  const hideRow = (id: string) => {
    setKept(k => new Set(k).add(id));
    onToggleLayer(id);
  };
  const showRow = (id: string, gatedNow: boolean) => {
    setKept(k => { const n = new Set(k); n.delete(id); return n; });
    onToggleLayer(id);
    if (gatedNow) onSetZoomOverride(id, true);
  };
  const removeRow = (id: string, visible: boolean) => {
    setKept(k => { const n = new Set(k); n.delete(id); return n; });
    onSetZoomOverride(id, false);
    if (visible) onToggleLayer(id);
  };

  return (
    <>
      <div className="absolute top-3 left-3 z-30 w-64 max-w-[calc(100%-1.5rem)] max-h-[calc(100%-1.5rem)] flex flex-col bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-fog-gray-dark/40 text-slate-blue">
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          className="w-full shrink-0 flex items-center justify-between px-3 py-2 text-left"
          aria-expanded={!collapsed}
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-blue/60">
            On the map
            {on.length > 0 && (
              <span className="ml-1.5 normal-case tracking-normal font-normal text-slate-blue/50">
                {inViewCount} of {on.length} in view
              </span>
            )}
          </span>
          <svg className={`w-3.5 h-3.5 text-slate-blue/50 transition-transform ${collapsed ? '-rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {!collapsed && (
          <div className="px-1.5 pb-1.5 flex-1 min-h-0 overflow-y-auto">
            {on.length === 0 && (
              <p className="px-2 py-2 text-xs text-slate-blue/60">No data layers are turned on.</p>
            )}
            {on.map(layer => {
              const { config } = layer;
              const overridden = zoomOverrides.has(config.id);
              const gated = !overridden && config.minZoom != null && zoom < config.minZoom;
              const hidden = !layer.visible;
              const visibleNow = layer.visible && inView.has(config.id);
              const infoOpen = openInfo === config.id;
              const accent = config.style.strokeColor || config.style.fillColor || '#0D4F4F';
              const nameTitle = hidden
                ? 'Hidden. Click to show'
                : gated
                  ? `Drawn from zoom ${config.minZoom}. Click to show it at this zoom`
                  : 'Click to hide';
              return (
                <div
                  key={config.id}
                  className={`relative rounded-md px-2 py-1.5 transition-colors ${
                    visibleNow ? 'bg-teal-50/80' : infoOpen ? '' : 'opacity-55'
                  }`}
                >
                  {visibleNow && (
                    <span aria-hidden="true" className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full" style={{ background: accent }} />
                  )}
                  <div className="flex items-center gap-2">
                    <Swatch config={config} />
                    <button
                      type="button"
                      onClick={() => (hidden ? showRow(config.id, gated) : gated ? onSetZoomOverride(config.id, true) : hideRow(config.id))}
                      className={`flex-1 min-w-0 text-left text-xs leading-tight truncate hover:text-deep-teal ${visibleNow ? 'font-semibold text-slate-blue' : hidden ? 'text-slate-blue/60 line-through decoration-slate-blue/30' : 'text-slate-blue/80'}`}
                      title={nameTitle}
                      aria-pressed={!hidden}
                    >
                      {config.name}
                    </button>
                    {hidden ? (
                      <span className="text-[10px] text-slate-blue/50 whitespace-nowrap">hidden</span>
                    ) : gated ? (
                      <button
                        type="button"
                        onClick={() => onSetZoomOverride(config.id, true)}
                        className="text-[10px] text-slate-blue/50 whitespace-nowrap hover:text-deep-teal underline decoration-dotted"
                        title={`Drawn from zoom ${config.minZoom}. Click to show it now`}
                      >
                        zoom in
                      </button>
                    ) : !visibleNow ? (
                      <span className="text-[10px] text-slate-blue/50 whitespace-nowrap" title="Nothing from this layer is inside the current map frame">
                        not in view
                      </span>
                    ) : null}
                    {hasInfo(config) && (
                      <button
                        type="button"
                        onClick={() => setOpenInfo(infoOpen ? null : config.id)}
                        aria-label={infoOpen ? `Hide info for ${config.name}` : `About ${config.name}`}
                        aria-expanded={infoOpen}
                        title="About this layer"
                        className={`shrink-0 w-4 h-4 inline-flex items-center justify-center rounded-full border text-[10px] font-semibold transition-colors ${
                          infoOpen
                            ? 'bg-deep-teal text-white border-deep-teal'
                            : 'bg-white text-slate-blue/50 border-slate-blue/30 hover:text-slate-blue hover:border-slate-blue/60'
                        }`}
                      >
                        i
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeRow(config.id, layer.visible)}
                      aria-label={`Remove ${config.name} from the map`}
                      title="Remove from the map"
                      className="w-5 h-5 shrink-0 inline-flex items-center justify-center rounded text-slate-blue/40 hover:text-slate-blue hover:bg-fog-gray transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  {infoOpen && <LayerInfo config={config} />}
                  {!gated && <CategoryChips config={config} className="mt-1 ml-6" />}
                </div>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={onExplore}
          className="w-full shrink-0 flex items-center justify-center gap-1.5 px-3 py-2 border-t border-fog-gray-dark/40 text-xs font-semibold text-deep-teal hover:bg-teal-50 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          Explore more data
        </button>

        <button
          type="button"
          onClick={() => setShowSourcing(true)}
          className="w-full shrink-0 flex items-center justify-center gap-1 px-3 py-1.5 border-t border-fog-gray-dark/40 text-[11px] text-ocean-blue hover:text-ocean-blue-light hover:bg-fog-gray/60 rounded-b-lg transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" strokeWidth={1.8} />
            <path strokeLinecap="round" strokeWidth={2} d="M12 11v5" />
            <circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" />
          </svg>
          How this is sourced
        </button>
      </div>

      {showSourcing && <SourcingModal layers={on} zoom={zoom} onClose={() => setShowSourcing(false)} />}
    </>
  );
}
