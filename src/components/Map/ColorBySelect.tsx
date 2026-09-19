import type { LayerState } from '../../types';

/**
 * "Color by" choice for vector layers with visualization modes (fish use:
 * which species colors the line). Shown in the sidebar row and the legend row.
 */
export function ColorBySelect({ layer, onChange, className = '' }: { layer: LayerState; onChange: (mode: string) => void; className?: string }) {
  const modes = layer.config.visualizationModes;
  if (!modes || modes.length < 2) return null;
  const value = layer.vizMode ?? modes[0].id;
  const id = `color-by-${layer.config.id}`;
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-[11px] text-slate-blue/60 whitespace-nowrap">Color by</label>
      <select
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="flex-1 min-w-0 text-[12px] font-semibold text-slate-blue bg-white border border-slate-blue/25 rounded px-1.5 py-0.5 hover:border-slate-blue/50 focus:outline-none focus:ring-1 focus:ring-deep-teal"
      >
        {modes.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
    </div>
  );
}
