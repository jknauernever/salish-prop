import { useEffect, useState } from 'react';
import type { LayerConfig, LayerState } from '../../types';
import { useIsMobile } from '../../hooks/useIsMobile';
import { LayerInfoModal, Swatch, CategoryChips } from './LayerInfoModal';
import { ColorBySelect } from './ColorBySelect';
import { legendGroupFor, LEGEND_FIRST, type LegendGroup } from '../../config/legendGroups';

// The legend unmounts while the dataset picker is open; remember its state
// across mounts so closing the picker does not re-run the first-open reveal.
let lastOpen: boolean | null = null;
let lastExpanded: string[] = [];

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
  onSetLayerUi: (layerId: string, patch: { vizMode?: string }) => void;
}

/** Swatch for a legend group: three stacked pin heads. */
function GroupSwatch() {
  return (
    <span className="inline-flex items-end -space-x-1.5 shrink-0" aria-hidden="true">
      <span className="w-2.5 h-2.5 rounded-full border border-white" style={{ background: '#1A73E8' }} />
      <span className="w-2.5 h-2.5 rounded-full border border-white" style={{ background: '#0B8FA8' }} />
      <span className="w-2.5 h-2.5 rounded-full border border-white" style={{ background: '#A0522D' }} />
    </span>
  );
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
export function MapLegend({ layers, onToggleLayer, onExplore, zoom, inView, zoomOverrides, onSetZoomOverride, onSetLayerUi }: MapLegendProps) {
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
  }, []);
  const [infoModal, setInfoModal] = useState<{ layers: LayerState[]; title: string; intro?: string } | null>(null);
  const setInfoLayer = (layer: LayerState) => setInfoModal({ layers: [layer], title: layer.config.name });
  // Legend groups start collapsed; remembered across mounts like the drawer
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(lastExpanded));
  const toggleExpanded = (id: string) => setExpanded(e => { const n = new Set(e); if (n.has(id)) n.delete(id); else n.add(id); lastExpanded = [...n]; return n; });
  const [showSourcing, setShowSourcing] = useState(false);
  // Layers hidden from the legend row (click on the name) stay listed until ×
  const [kept, setKept] = useState<Set<string>>(() => new Set());
  const rank = (id: string) => { const i = LEGEND_FIRST.indexOf(id); return i === -1 ? LEGEND_FIRST.length : i; };
  const on = layers
    .filter(l => (l.visible || kept.has(l.config.id)) && !l.config.placeholder)
    .sort((a, b) => rank(a.config.id) - rank(b.config.id)); // stable: config order otherwise
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

  // Rows in order: a group takes the place of its first member and swallows the rest
  type Entry = { kind: 'layer'; layer: LayerState } | { kind: 'group'; group: LegendGroup; members: LayerState[] };
  const entries: Entry[] = [];
  const grouped = new Set<string>();
  for (const layer of on) {
    const g = legendGroupFor(layer.config.id);
    if (!g) { entries.push({ kind: 'layer', layer }); continue; }
    if (grouped.has(g.id)) continue;
    grouped.add(g.id);
    const members = g.layers.map(id => on.find(l => l.config.id === id)).filter((l): l is LayerState => !!l);
    entries.push({ kind: 'group', group: g, members });
  }
  const groupState = (members: LayerState[]) => {
    const anyVisible = members.some(m => m.visible);
    const inViewN = members.filter(m => m.visible && inView.has(m.config.id)).length;
    const allGated = members.every(m => !zoomOverrides.has(m.config.id) && m.config.minZoom != null && zoom < m.config.minZoom);
    return { anyVisible, inViewN, allGated };
  };
  const toggleGroup = (members: LayerState[]) => {
    const { anyVisible } = groupState(members);
    for (const m of members) {
      const gated = !zoomOverrides.has(m.config.id) && m.config.minZoom != null && zoom < m.config.minZoom;
      if (anyVisible) { if (m.visible) hideRow(m.config.id); }
      else showRow(m.config.id, gated);
    }
  };
  const removeGroup = (members: LayerState[]) => { for (const m of members) removeRow(m.config.id, m.visible); };

  const renderRow = (layer: LayerState, sub = false) => {
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
        className={`relative rounded-md py-1.5 transition-colors ${sub ? 'pl-7 pr-2' : 'px-2'} ${
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
            {sub ? config.name.replace(/ \(2019 survey\)$/, '') : config.name}
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
        {!hidden && config.fishUse && <ColorBySelect layer={layer} onChange={mode => onSetLayerUi(config.id, { vizMode: mode })} className="mt-1 ml-6" />}
        {!gated && <CategoryChips config={config} className="mt-1 ml-6" />}
      </div>
    );
  };

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
            {entries.map(entry => {
              if (entry.kind === 'group') {
                const { anyVisible, inViewN } = groupState(entry.members);
                const state = anyVisible ? 'on. Click to hide' : 'hidden. Click to show';
                return (
                  <button
                    key={entry.group.id}
                    type="button"
                    onClick={() => toggleGroup(entry.members)}
                    title={`${entry.group.name}: ${state}`}
                    aria-label={`${entry.group.name}: ${state}`}
                    aria-pressed={anyVisible}
                    className={`relative w-8 h-8 inline-flex items-center justify-center rounded-md hover:bg-fog-gray transition-colors ${!anyVisible ? 'opacity-30' : inViewN ? '' : 'opacity-60'}`}
                  >
                    <GroupSwatch />
                    {!anyVisible && <span aria-hidden="true" className="absolute inset-x-1.5 top-1/2 h-[2px] -rotate-45 bg-slate-blue/70 rounded" />}
                  </button>
                );
              }
              const layer = entry.layer;
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
            {entries.map(entry => {
              if (entry.kind === 'layer') return renderRow(entry.layer);
              const { group, members } = entry;
              const { anyVisible, inViewN, allGated } = groupState(members);
              const isOpen = expanded.has(group.id);
              return (
                <div key={group.id} className={`relative rounded-md transition-colors ${inViewN ? 'bg-teal-50/80' : 'opacity-70'}`}>
                  {inViewN > 0 && <span aria-hidden="true" className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full" style={{ background: group.style === 'chips' ? (members[0].config.style.strokeColor || '#0D4F4F') : '#A0522D' }} />}
                  <div className="flex items-center gap-2 px-2 py-1.5">
                    {group.style !== 'chips' && <button
                      type="button"
                      onClick={() => toggleExpanded(group.id)}
                      aria-expanded={isOpen}
                      aria-label={isOpen ? `Collapse ${group.name}` : `Expand ${group.name}`}
                      className="w-4 h-4 -ml-0.5 inline-flex items-center justify-center rounded text-slate-blue/50 hover:text-slate-blue hover:bg-fog-gray transition-colors"
                    >
                      <svg className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>}
                    {group.style === 'chips' ? <Swatch config={members[0].config} /> : <GroupSwatch />}
                    <button
                      type="button"
                      onClick={() => toggleGroup(members)}
                      className={`flex-1 min-w-0 text-left text-sm leading-snug hover:text-deep-teal ${inViewN ? 'font-semibold text-slate-blue' : anyVisible ? 'text-slate-blue/85' : 'text-slate-blue/60 line-through decoration-slate-blue/30'}`}
                      title={anyVisible ? 'Click to hide all' : 'Click to show all'}
                      aria-pressed={anyVisible}
                    >
                      {group.name}
                      <span className="ml-1.5 font-normal text-[11px] text-slate-blue/60 whitespace-nowrap">{anyVisible ? `${inViewN} of ${members.length} in view` : 'hidden'}</span>
                    </button>
                    {anyVisible && allGated && (
                      <button
                        type="button"
                        onClick={() => members.forEach(m => onSetZoomOverride(m.config.id, true))}
                        className="text-[11px] text-slate-blue/60 whitespace-nowrap hover:text-deep-teal underline decoration-dotted"
                        title="Drawn from zoom 16. Click to show them now"
                      >
                        zoom in
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setInfoModal({ layers: members, title: group.name, intro: group.description })}
                      aria-label={`About ${group.name}`}
                      title="About these layers"
                      className="shrink-0 w-[18px] h-[18px] inline-flex items-center justify-center rounded-full border text-[11px] font-semibold transition-colors bg-white text-slate-blue/50 border-slate-blue/30 hover:text-slate-blue hover:border-slate-blue/60"
                    >
                      i
                    </button>
                    <button
                      type="button"
                      onClick={() => removeGroup(members)}
                      aria-label={`Remove ${group.name} from the map`}
                      title="Remove from the map"
                      className="w-5 h-5 shrink-0 inline-flex items-center justify-center rounded text-slate-blue/40 hover:text-slate-blue hover:bg-fog-gray transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  {group.style === 'chips' && (
                    <div className="flex flex-wrap gap-x-2.5 gap-y-1 pl-6 pr-2 pb-1.5">
                      {members.map(m => {
                        const gated = !zoomOverrides.has(m.config.id) && m.config.minZoom != null && zoom < m.config.minZoom;
                        const lit = m.visible && inView.has(m.config.id);
                        const label = group.shortLabels?.[m.config.id] ?? m.config.name;
                        return (
                          <button
                            key={m.config.id}
                            type="button"
                            onClick={() => (!m.visible ? showRow(m.config.id, gated) : gated ? onSetZoomOverride(m.config.id, true) : hideRow(m.config.id))}
                            aria-pressed={m.visible}
                            title={!m.visible ? 'Hidden. Click to show' : gated ? `Drawn from zoom ${m.config.minZoom}. Click to show it now` : 'Click to hide'}
                            className={`inline-flex items-center gap-1.5 text-[11px] leading-tight text-left rounded px-0.5 hover:text-deep-teal transition-colors ${!m.visible ? 'text-slate-blue/45 line-through decoration-slate-blue/30' : lit ? 'text-slate-blue font-semibold' : 'text-slate-blue/75'}`}
                          >
                            <Swatch config={m.config} />
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {isOpen && group.style !== 'chips' && <div className="pb-1">{members.map(m => renderRow(m, true))}</div>}
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
      {infoModal && <LayerInfoModal layers={infoModal.layers} zoom={zoom} title={infoModal.title} intro={infoModal.intro} onClose={() => setInfoModal(null)} />}
    </>
  );
}
