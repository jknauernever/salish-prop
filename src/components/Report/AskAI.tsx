export function AskAI() {
  return (
    <div className="rounded-lg border border-driftwood/30 bg-driftwood/5 p-4">
      <div className="flex items-center gap-2 mb-2">
        <svg className="w-4 h-4 text-driftwood" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        <h3 className="text-sm font-semibold text-slate-blue">
          Ask AI about this property
        </h3>
        <span className="text-xs bg-driftwood/20 text-driftwood px-1.5 py-0.5 rounded-full font-medium">
          Coming soon
        </span>
      </div>
      <p className="text-xs text-slate-blue/50 mb-3">
        Get a plain-language summary of the ecological features near this property
        and what they mean for conservation.
      </p>
      <textarea
        disabled
        placeholder="e.g., What eelgrass habitat exists near my property and why does it matter?"
        className="
          w-full h-16 px-3 py-2 rounded-md text-xs
          bg-white border border-fog-gray-dark/30
          text-slate-blue/40 placeholder-slate-blue/25
          resize-none cursor-not-allowed
        "
      />
      <button
        disabled
        className="
          mt-2 w-full py-2 rounded-md text-xs font-medium
          bg-fog-gray text-slate-blue/30 cursor-not-allowed
        "
      >
        Tell me about this place
      </button>
    </div>
  );
}
