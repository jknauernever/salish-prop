import { useState } from 'react';
import { isBlankHtml } from '../../services/siteContent';
import { useIsMobile } from '../../hooks/useIsMobile';

const DISMISSED_KEY = 'landing_intro_dismissed';

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(value: boolean): void {
  try {
    if (value) window.sessionStorage.setItem(DISMISSED_KEY, '1');
    else window.sessionStorage.removeItem(DISMISSED_KEY);
  } catch {
    /* sessionStorage unavailable — dismissal just won't persist */
  }
}

interface LandingIntroCardProps {
  html: string;
  onClose?: () => void;
  className?: string;
}

/**
 * Presentational card for the landing intro. Also used by the admin editor's
 * live preview so what admins see is exactly what the map shows.
 *
 * The HTML is sanitized server-side (allowlisted tags only) before it is
 * stored, so rendering it here is safe.
 */
export function LandingIntroCard({ html, onClose, className = '' }: LandingIntroCardProps) {
  return (
    <div
      className={`bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-fog-gray-dark/40 ${className}`}
    >
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Close introduction"
          className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-full text-slate-blue/50 hover:text-slate-blue hover:bg-fog-gray transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
      <div
        className="rich-text text-sm text-slate-blue px-4 py-3.5 pr-9 max-h-[55vh] overflow-y-auto"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {onClose && (
        <div className="px-4 pb-3.5">
          <button
            onClick={onClose}
            className="w-full bg-slate-blue hover:bg-slate-blue-light text-white text-sm font-medium py-2 rounded-md transition-colors"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The admin-written intro talks about scroll wheels and +/− buttons. On a
 * phone those lines are swapped for touch equivalents; everything else is
 * left exactly as written.
 */
function adaptIntroForTouch(html: string): string {
  return html
    .replace(/<strong>Zoom in<\/strong>[\s\S]*?\.(?=\s*<\/(?:li|p)>)/i, '<strong>Pinch</strong> to zoom in on a shoreline, and drag to move around.')
    .replace(/\(menu icon, top left\)/i, '(☰, top left)');
}

interface LandingIntroProps {
  html: string;
  /** Start collapsed to the pill (e.g. when the visitor arrived via a shared link). */
  defaultDismissed?: boolean;
}

/**
 * Floating intro box at the top center of the map on the landing page.
 * Content comes from /admin/content. Dismissible; the dismissal is remembered
 * for the browser tab (sessionStorage) and a small "About this map" pill lets
 * visitors bring it back.
 */
export function LandingIntro({ html, defaultDismissed = false }: LandingIntroProps) {
  const [dismissed, setDismissed] = useState<boolean>(() => defaultDismissed || readDismissed());
  const mobile = useIsMobile();
  const shown = mobile ? adaptIntroForTouch(html) : html;

  if (isBlankHtml(html)) return null;

  function close() {
    setDismissed(true);
    writeDismissed(true);
  }

  function open() {
    setDismissed(false);
    writeDismissed(false);
  }

  if (dismissed) {
    return (
      <button
        onClick={open}
        className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 bg-white/95 backdrop-blur-sm text-slate-blue text-xs font-medium px-3 py-1.5 rounded-full shadow-md border border-fog-gray-dark/40 hover:bg-white transition-colors"
      >
        <svg className="w-3.5 h-3.5 text-deep-teal" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        About this map
      </button>
    );
  }

  return (
    <LandingIntroCard
      html={shown}
      onClose={close}
      className="absolute top-3 left-1/2 -translate-x-1/2 z-30 w-[26rem] max-w-[calc(100%-1.5rem)]"
    />
  );
}
