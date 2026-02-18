import { useState } from 'react';
import type { SpatialQueryResult } from '../../types';
import { layerConfigs } from '../../config/layers';
import { extractAllFeatureProperties, getFeatureLabel } from '../../utils/geojson';
import { Badge } from '../common/Badge';

interface ReportSectionProps {
  result: SpatialQueryResult;
}

export function ReportSection({ result }: ReportSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const config = layerConfigs.find(l => l.id === result.layerId);

  return (
    <div className="px-5 py-3">
      {/* Section header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left group"
      >
        <div
          className="w-3 h-3 rounded-sm shrink-0"
          style={{ backgroundColor: result.style.fillColor || result.style.strokeColor }}
        />
        <span className="text-sm font-semibold text-slate-blue flex-1">
          {result.layerName}
        </span>
        <Badge count={result.count} />
        <svg
          className={`w-4 h-4 text-slate-blue/40 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-2 ml-5">
          {/* Standard messaging */}
          {config?.standardMessage && (
            <p className="text-xs text-slate-blue/60 leading-relaxed mb-3 p-2.5 bg-forest-green/5 rounded-md border-l-2 border-forest-green/30">
              {config.standardMessage}
            </p>
          )}

          {/* Feature list */}
          <div className="space-y-1.5">
            {result.features.slice(0, 50).map((feature, i) => (
              <FeatureItem
                key={i}
                feature={feature}
                layerId={result.layerId}
                popupFields={config?.popupFields || []}
              />
            ))}
            {result.count > 50 && (
              <p className="text-xs text-slate-blue/40 py-1">
                + {result.count - 50} more features
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FeatureItem({
  feature,
  layerId,
  popupFields,
}: {
  feature: GeoJSON.Feature;
  layerId: string;
  popupFields: { key: string; label: string }[];
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const label = getFeatureLabel(feature, layerId);
  const fields = extractAllFeatureProperties(feature, popupFields);

  return (
    <div className="rounded-md border border-fog-gray-dark/20 overflow-hidden">
      <button
        onClick={() => setDetailOpen(!detailOpen)}
        className="flex items-center gap-2 w-full px-2.5 py-1.5 text-left hover:bg-fog-gray/30 transition-colors"
      >
        <span className="text-xs text-slate-blue flex-1 truncate">{label}</span>
        {fields.length > 0 && (
          <svg
            className={`w-3 h-3 text-slate-blue/30 shrink-0 transition-transform ${detailOpen ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {detailOpen && fields.length > 0 && (
        <div className="px-2.5 pb-2 border-t border-fog-gray-dark/10">
          <table className="text-xs w-full mt-1.5">
            <tbody>
              {fields.map((f, i) => (
                <tr key={i}>
                  <td className="text-slate-blue/50 pr-2 py-0.5 align-top whitespace-nowrap">{f.label}</td>
                  <td className="text-slate-blue py-0.5 break-words">{f.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
