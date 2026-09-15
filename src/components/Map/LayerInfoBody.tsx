import type { LayerConfig } from '../../types';

/**
 * The body of a layer's "about" panel: its description, then any structured
 * definitions (`config.infoItems`) as a readable list — bold names, a swatch
 * where the item has a map color, and indented sub-definitions.
 */
export function LayerInfoBody({ config, className = '' }: { config: LayerConfig; className?: string }) {
  const intro = config.standardMessage ?? config.description;
  return (
    <div className={className}>
      {intro && <p className="m-0">{intro}</p>}
      {config.infoItems && config.infoItems.length > 0 && (
        <ul className="m-0 mt-2 p-0 list-none space-y-1.5">
          {config.infoItems.map(item => (
            <li key={item.label} className="flex gap-2">
              {item.color && (
                <span aria-hidden="true" className="mt-[5px] inline-block w-3 h-[3px] rounded shrink-0" style={{ background: item.color }} />
              )}
              <div className="min-w-0">
                <span className="font-semibold text-slate-blue">{item.label}</span>
                {item.text && <span> — {item.text}</span>}
                {item.sub && item.sub.length > 0 && (
                  <ul className="m-0 mt-1 pl-3 list-disc space-y-0.5 marker:text-slate-blue/40">
                    {item.sub.map(sub => (
                      <li key={sub.label}>
                        <span className="font-semibold">{sub.label}</span> — {sub.text}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
