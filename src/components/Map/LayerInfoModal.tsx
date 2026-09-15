import { useEffect } from 'react';
import type { LayerConfig, LayerState } from '../../types';
import { LayerInfoBody } from './LayerInfoBody';

/** Small swatch that mirrors how the layer draws on the map. */
export function Swatch({ config }: { config: LayerConfig }) {
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
export function CategoryChips({ config, className = '' }: { config: LayerConfig; className?: string }) {
  const cat = config.legend?.type === 'categories' ? config.legend : null;
  if (!cat) return null;
  return (
    <div className={`flex flex-wrap gap-x-2.5 gap-y-0.5 ${className}`}>
      {cat.items.map(item => (
        <span key={item.label} className="inline-flex items-center gap-1 text-[11px] text-slate-blue/75">
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

/**
 * One modal for layer reference: either "How this is sourced" (every dataset
 * on the map) or a single layer's own page (its info button). Each layer
 * shows its swatch, description, structured definitions, legend chips and
 * source credit.
 */
export function LayerInfoModal({ layers, zoom, title, intro, onClose }: { layers: LayerState[]; zoom: number; title: string; intro?: string; onClose: () => void }) {
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
          <h2 id="sourcing-title" className="m-0 text-xl font-bold text-slate-blue">{title}</h2>
        </div>

        <div className="px-6 py-4 overflow-y-auto text-sm leading-relaxed">
          {intro && (
            <>
              <p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-deep-teal">What you're looking at</p>
              <p className="mt-1.5 mb-4 text-slate-blue/80">{intro}</p>
            </>
          )}
          {layers.length > 1 && (
            <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wider text-deep-teal">The layers · {layers.length}</p>
          )}
          {layers.length === 0 && (
            <p className="m-0 text-slate-blue/60">No data layers are turned on.</p>
          )}
          <ul className="m-0 p-0 list-none divide-y divide-fog-gray-dark/30">
            {layers.map(({ config }) => {
              const gated = config.minZoom != null && zoom < config.minZoom;
              return (
                <li key={config.id} className="py-3">
                  <div className="flex items-center gap-2">
                    {layers.length > 1 && <Swatch config={config} />}
                    {layers.length > 1 && <span className="font-semibold text-slate-blue">{config.name}</span>}
                    {gated && (
                      <span className="text-[10px] text-slate-blue/50">drawn at zoom {config.minZoom}+ — zoom in to see it</span>
                    )}
                  </div>
                  {(config.standardMessage || config.description) && (
                    <LayerInfoBody config={config} className="mt-1 text-slate-blue/80" />
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

