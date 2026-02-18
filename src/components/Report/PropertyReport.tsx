import type { SpatialQueryResult } from '../../types';
import { layerConfigs } from '../../config/layers';
import { extractAllFeatureProperties } from '../../utils/geojson';
import { ReportSection } from './ReportSection';
import { AskAI } from './AskAI';

interface PropertyReportProps {
  address: string;
  radiusMeters: number;
  results: SpatialQueryResult[];
  homeParcel: GeoJSON.Feature | null;
  totalFeatureCount: number;
  isQuerying: boolean;
  onRadiusChange: (meters: number) => void;
  onClose: () => void;
}

const RADIUS_OPTIONS = [
  { label: '¼ mi', meters: 402 },
  { label: '½ mi', meters: 805 },
  { label: '1 mi', meters: 1609 },
  { label: '2 mi', meters: 3219 },
];

export function PropertyReport({
  address,
  radiusMeters,
  results,
  homeParcel,
  totalFeatureCount,
  isQuerying,
  onRadiusChange,
  onClose,
}: PropertyReportProps) {
  const parcelConfig = layerConfigs.find(l => l.id === 'tax-parcels');
  const parcelFields = homeParcel && parcelConfig
    ? extractAllFeatureProperties(homeParcel, parcelConfig.popupFields)
    : [];

  return (
    <div
      className="
        absolute top-14 right-0 bottom-0 z-40
        w-96 bg-white shadow-2xl border-l border-fog-gray-dark/30
        flex flex-col overflow-hidden
        animate-slide-in-right
      "
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-fog-gray-dark/20 bg-sand/50">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-slate-blue leading-tight">
              Property Report
            </h2>
            <p className="text-xs text-slate-blue/60 mt-0.5 truncate" title={address}>
              {address}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-blue/40 hover:text-slate-blue p-1 -mr-1 transition-colors"
            aria-label="Close report"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Radius selector */}
        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs text-slate-blue/50">Radius:</span>
          <div className="flex gap-1">
            {RADIUS_OPTIONS.map(opt => (
              <button
                key={opt.meters}
                onClick={() => onRadiusChange(opt.meters)}
                className={`
                  px-2.5 py-1 rounded-md text-xs font-medium transition-colors
                  ${radiusMeters === opt.meters
                    ? 'bg-deep-teal text-white'
                    : 'bg-fog-gray text-slate-blue/70 hover:bg-fog-gray-dark/50'
                  }
                `}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Summary */}
        <div className="mt-3 flex items-center gap-2">
          <span className={`
            inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold
            ${totalFeatureCount > 0 ? 'bg-deep-teal/10 text-deep-teal' : 'bg-fog-gray text-slate-blue/50'}
          `}>
            {isQuerying ? '...' : totalFeatureCount.toLocaleString()} features found
          </span>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {/* Home Parcel Card */}
        {homeParcel && parcelFields.length > 0 && (
          <div className="px-5 py-4 border-b border-fog-gray-dark/20 bg-deep-teal/[0.03]">
            <div className="flex items-center gap-2 mb-2.5">
              <svg className="w-4 h-4 text-deep-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              <h3 className="text-sm font-semibold text-deep-teal">Your Parcel</h3>
              {homeParcel.properties?.PIN && (
                <span className="text-xs bg-deep-teal/10 text-deep-teal px-1.5 py-0.5 rounded font-mono">
                  {homeParcel.properties.PIN}
                </span>
              )}
            </div>
            <table className="text-xs w-full">
              <tbody>
                {parcelFields.map((f, i) => (
                  <tr key={i}>
                    <td className="text-slate-blue/50 pr-3 py-0.5 align-top whitespace-nowrap">{f.label}</td>
                    <td className="text-slate-blue py-0.5 break-words">{f.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {isQuerying ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-sm text-slate-blue/50">Searching...</div>
          </div>
        ) : results.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="text-slate-blue/30 mb-2">
              <svg className="w-10 h-10 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
            </div>
            <p className="text-sm text-slate-blue/50">
              No features found within this radius.
            </p>
            <p className="text-xs text-slate-blue/30 mt-1">
              Try increasing the search radius or enabling more layers.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-fog-gray-dark/15">
            {results.map(result => (
              <ReportSection key={result.layerId} result={result} />
            ))}
          </div>
        )}

        {/* AI Placeholder */}
        <div className="p-5 border-t border-fog-gray-dark/20">
          <AskAI />
        </div>

        {/* Download stub */}
        <div className="px-5 pb-5">
          <button
            className="
              w-full py-2.5 rounded-lg border border-fog-gray-dark/30
              text-sm font-medium text-slate-blue/60
              hover:bg-fog-gray/50 transition-colors
            "
          >
            Download Report (Coming Soon)
          </button>
        </div>
      </div>
    </div>
  );
}
