import { useEffect, useState } from 'react';
import type { LayerConfig, LayerState } from '../../types';
import { useIsMobile } from '../../hooks/useIsMobile';
import { LayerInfoModal, Swatch, CategoryChips } from './LayerInfoModal';

// The legend unmounts while the dataset picker is open; remember its state
// across mounts so closing the picker does not re-run the first-open reveal.
let lastOpen: boolean | null = null;

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

/**
 * Floating "what's on the map" legend. Lists only the layers that are
 * currently switched on, each with its swatch (or categorical legend), an
 * info button, a zoom hint when the layer is gated, and an off switch. The
 * footer opens the full dataset picker, and "How this is sourced" opens a
 * modal describing every visible dataset.
 */
export function MapLegend({ layers, onToggleLayer, onExplore, zoom, inView, zoomOverrides, onSetZoomOverride }: MapLegendProps) {
  const mobile = useIsMobile();
  // Drawer from the left edge: starts tucked away, slides open shortly after
  // first paint so people see it arrive, then a handle (or the ×) toggles it.
  // Phones start closed (a "Layers" pill) and open as a bottom sheet.
  const [open, setOpenState] = useState<boolean>(() => lastOpen ?? false);
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => {
    setOpenState(o => { const n = typeof v === 'function' ? v(o) : v; lastOpen = n; return n; });
  };
  useEffect(() => {
    if (lastOpen != null || mobile) return;
    const t = window.setTimeout(() => setOpen(true), 450);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [infoLayer, setInfoLayer] = useState<LayerState | null>(null);
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

  const panelW = mobile ? 'w-full' : 'w-80';

  return (
    <>
      {mobile && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className="absolute bottom-3 right-3 z-30 flex items-center gap-1.5 bg-white/95 backdrop-blur-sm text-slate-blue text-sm font-semibold pl-3 pr-3.5 py-2 rounded-full shadow-lg border border-fog-gray-dark/40"
        >
          <svg className="w-4 h-4 text-deep-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" />
          </svg>
          Layers
          {on.length > 0 && <span className="text-xs font-normal text-slate-blue/60">{inViewCount}/{on.length}</span>}
        </button>
      )}
      {mobile && open && (
        <div
          role="presentation"
          onClick={() => setOpen(false)}
          className="absolute inset-0 z-30 bg-slate-blue/20"
        />
      )}
      <div className={mobile
        ? `absolute inset-x-0 bottom-0 z-30 flex flex-col max-h-[70%] transition-transform duration-300 ease-out ${open ? 'translate-y-0' : 'translate-y-full pointer-events-none'}`
        : 'absolute top-3 left-0 z-30 flex items-start max-h-[calc(100%-1.5rem)]'}>
      <div
        className={mobile
          ? 'w-full min-h-0 flex flex-col bg-white rounded-t-2xl shadow-2xl border-t border-fog-gray-dark/40 text-slate-blue overflow-hidden'
          : 'max-w-[calc(100vw-3rem)] max-h-[calc(100vh-7rem)] flex flex-col bg-white/95 backdrop-blur-sm rounded-r-lg shadow-lg border border-l-0 border-fog-gray-dark/40 text-slate-blue overflow-hidden transition-[width] duration-500 ease-out motion-reduce:transition-none'}
        style={mobile ? undefined : { width: open ? '20rem' : '2.75rem' }}
      >
        {mobile && (
          <button type="button" onClick={() => setOpen(false)} aria-label="Close the legend" className="shrink-0 h-5 w-full flex items-center justify-center">
            <span aria-hidden="true" className="w-10 h-1 rounded-full bg-slate-blue/25" />
          </button>
        )}
        {!mobile && !open && (
          /* Collapsed rail: just the swatches of what's on the map */
          <div className="flex flex-col items-center gap-1 py-2 w-11">
            {on.map(layer => {
              const { config } = layer;
              const hidden = !layer.visible;
              const gated = !zoomOverrides.has(config.id) && config.minZoom != null && zoom < config.minZoom;
              const lit = layer.visible && inView.has(config.id);
              const state = hidden ? 'hidden. Click to show' : gated ? 'click to show at this zoom' : 'on. Click to hide';
              return (
                <button
                  key={config.id}
                  type="button"
                  onClick={() => (hidden ? showRow(config.id, gated) : gated ? onSetZoomOverride(config.id, true) : hideRow(config.id))}
                  title={`${config.name}: ${state}`}
                  aria-label={`${config.name}: ${state}`}
                  aria-pressed={!hidden}
                  className={`relative w-8 h-8 inline-flex items-center justify-center rounded-md hover:bg-fog-gray transition-colors ${hidden ? 'opacity-30' : lit ? '' : 'opacity-60'}`}
                >
                  <Swatch config={config} />
                  {hidden && <span aria-hidden="true" className="absolute inset-x-1.5 top-1/2 h-[2px] -rotate-45 bg-slate-blue/70 rounded" />}
                </button>
              );
            })}
            <span aria-hidden="true" className="w-6 border-t border-fog-gray-dark/50 my-1" />
            <button
              type="button"
              onClick={onExplore}
              title="Explore more data"
              aria-label="Explore more data"
              className="w-8 h-8 inline-flex items-center justify-center rounded-md text-deep-teal hover:bg-teal-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        )}
        {(open || mobile) && (<>
        <div className={`${panelW} shrink-0 flex items-center justify-between pl-3 pr-1.5 py-1.5`}>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-blue/70">
            On the map
            {on.length > 0 && (
              <span className="ml-1.5 normal-case tracking-normal font-normal text-slate-blue/60">
                {inViewCount} of {on.length} in view
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close the legend"
            title="Close"
            className="w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-full text-slate-blue/50 hover:text-slate-blue hover:bg-fog-gray transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {(
          <div className={`${panelW} px-1.5 pb-1.5 flex-1 min-h-0 overflow-y-auto`}>
            {on.length === 0 && (
              <p className="px-2 py-2 text-sm text-slate-blue/70">No data layers are turned on.</p>
            )}
            {on.map(layer => {
              const { config } = layer;
              const overridden = zoomOverrides.has(config.id);
              const gated = !overridden && config.minZoom != null && zoom < config.minZoom;
              const hidden = !layer.visible;
              const visibleNow = layer.visible && inView.has(config.id);
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
                    visibleNow ? 'bg-teal-50/80' : 'opacity-55'
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
                      className={`flex-1 min-w-0 text-left text-sm leading-snug hover:text-deep-teal ${visibleNow ? 'font-semibold text-slate-blue' : hidden ? 'text-slate-blue/60 line-through decoration-slate-blue/30' : 'text-slate-blue/85'}`}
                      title={nameTitle}
                      aria-pressed={!hidden}
                    >
                      {config.name}
                    </button>
                    {hidden ? (
                      <span className="text-[11px] text-slate-blue/60 whitespace-nowrap">hidden</span>
                    ) : gated ? (
                      <button
                        type="button"
                        onClick={() => onSetZoomOverride(config.id, true)}
                        className="text-[11px] text-slate-blue/60 whitespace-nowrap hover:text-deep-teal underline decoration-dotted"
                        title={`Drawn from zoom ${config.minZoom}. Click to show it now`}
                      >
                        zoom in
                      </button>
                    ) : null}
                    {hasInfo(config) && (
                      <button
                        type="button"
                        onClick={() => setInfoLayer(layer)}
                        aria-label={`About ${config.name}`}
                        title="About this layer"
                        className="shrink-0 w-[18px] h-[18px] inline-flex items-center justify-center rounded-full border text-[11px] font-semibold transition-colors bg-white text-slate-blue/50 border-slate-blue/30 hover:text-slate-blue hover:border-slate-blue/60"
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
                  {!gated && <CategoryChips config={config} className="mt-1 ml-6" />}
                </div>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={onExplore}
          className={`${panelW} shrink-0 flex items-center justify-center gap-1.5 px-3 py-2.5 border-t border-fog-gray-dark/40 text-sm font-semibold text-deep-teal hover:bg-teal-50 transition-colors`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          Explore more data
        </button>

        <button
          type="button"
          onClick={() => setShowSourcing(true)}
          className={`${panelW} shrink-0 flex items-center justify-center gap-1 px-3 py-2 border-t border-fog-gray-dark/40 text-xs text-ocean-blue hover:text-ocean-blue-light hover:bg-fog-gray/60 rounded-br-lg transition-colors`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" strokeWidth={1.8} />
            <path strokeLinecap="round" strokeWidth={2} d="M12 11v5" />
            <circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" />
          </svg>
          How this is sourced
        </button>
        </>)}
      </div>

        {/* Handle: a subtle pull tab on the drawer's edge */}
        {!mobile && <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Hide the legend' : 'Show the legend'}
          aria-expanded={open}
          title={open ? 'Hide the legend' : 'Show the legend'}
          className="mt-8 -ml-px w-5 h-14 shrink-0 flex items-center justify-center rounded-r-lg bg-white/95 backdrop-blur-sm border border-l-0 border-fog-gray-dark/40 shadow-md text-slate-blue/50 hover:text-deep-teal hover:bg-white transition-colors"
        >
          <svg className={`w-3.5 h-3.5 transition-transform duration-500 ${open ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>}
      </div>

      {showSourcing && (
        <LayerInfoModal
          layers={on}
          zoom={zoom}
          title="How this is sourced"
          intro="Each layer below comes from a published dataset — county GIS, Washington state agencies, federal satellite products, or field surveys by Friends of the San Juans and its partners. The map draws the data as its source published it and credits that source on every layer, with a link to the dataset where one is available. This list always matches what is on the map right now; turn layers on and off from the legend or the dataset picker."
          onClose={() => setShowSourcing(false)}
        />
      )}
      {infoLayer && <LayerInfoModal layers={[infoLayer]} zoom={zoom} title={infoLayer.config.name} onClose={() => setInfoLayer(null)} />}
    </>
  );
}
