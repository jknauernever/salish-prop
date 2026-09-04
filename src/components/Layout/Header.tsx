import { type ReactNode, useState, useRef, useEffect } from 'react';
import { ShareButton } from './ShareButton';

interface HeaderProps {
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  searchBar?: ReactNode;
  hideSidebarToggle?: boolean;
  extraAction?: ReactNode;
}

type ResourceKind = 'link' | 'pdf' | 'video' | 'report';

interface ResourceItem {
  label: string;
  /** One-line context shown under the label. */
  note?: string;
  href: string;
  kind: ResourceKind;
}

interface ResourceGroup {
  heading: string;
  items: ResourceItem[];
}

const RESOURCE_GROUPS: ResourceGroup[] = [
  {
    heading: 'Get involved',
    items: [
      {
        label: 'Sign up for a shoreline site visit',
        note: 'Free technical assistance for landowners',
        href: 'https://sanjuans.org/our-work/landowner-resources/#SiteVisit',
        kind: 'link',
      },
      {
        label: 'Green boating',
        note: 'Protecting eelgrass and water quality while you boat',
        href: 'https://sanjuans.org/get-involved/green-boating/',
        kind: 'link',
      },
      {
        label: 'Anchor-out map',
        note: 'Where to anchor clear of eelgrass',
        href: 'https://sanjuans.org/wp-content/uploads/2020/06/FSJ_AnchorOutMap_Newley.pdf',
        kind: 'pdf',
      },
    ],
  },
  {
    heading: 'Research',
    items: [
      {
        label: 'Taking the Pulse of Resilience in Conserving Seagrass Meadows',
        note: 'Eelgrass research paper',
        href: 'https://sanjuans.org/wp-content/uploads/2024/09/icae120-2-final_takingthepulseofresilienceinconservingseagrassmeadows.pdf',
        kind: 'pdf',
      },
      {
        label: 'Forage Fish Tidal Spawn Study',
        note: 'Whitman et al., 2014',
        href: 'https://sanjuans.org/wp-content/uploads/2016/11/Whitmanetal2014_tidal_spawn_study_final_no_appendices.pdf',
        kind: 'pdf',
      },
      {
        label: 'Tracking Change: Shoreline Armoring in San Juan County',
        note: 'Research webinar',
        href: 'https://www.youtube.com/watch?v=Ts8aC0REZJA',
        kind: 'video',
      },
    ],
  },
  {
    heading: 'Reports from this map',
    items: [
      { label: 'Living with the Shoreline', href: '/reports/living-with-the-shoreline.html', kind: 'report' },
      { label: 'Kelp Value and Threats', href: '/reports/kelp-habitat-value-and-threats.html', kind: 'report' },
    ],
  },
];

function ResourceIcon({ kind }: { kind: ResourceKind }) {
  const cls = 'w-4 h-4 shrink-0 mt-0.5';
  switch (kind) {
    case 'pdf':
      return (
        <svg className={`${cls} text-red-500/80`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 3v5a1 1 0 001 1h5" />
        </svg>
      );
    case 'video':
      return (
        <svg className={`${cls} text-ocean-blue`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      );
    case 'report':
      return (
        <svg className={`${cls} text-deep-teal`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    default:
      return (
        <svg className={`${cls} text-forest-green-light`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      );
  }
}

/** The grouped resource links, shared by the desktop dropdown and the phone menu. */
function ResourceList({ onPick }: { onPick: () => void }) {
  return (
    <>
              {RESOURCE_GROUPS.map((group, gi) => (
                <div key={group.heading} className={gi > 0 ? 'border-t border-fog-gray mt-1 pt-1' : ''}>
                  <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-blue/45">
                    {group.heading}
                  </p>
                  {group.items.map((r) => (
                    <a
                      key={r.href}
                      href={r.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={onPick}
                      className="flex items-start gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-teal-50 hover:text-deep-teal transition-colors"
                    >
                      <ResourceIcon kind={r.kind} />
                      <span className="flex-1 min-w-0">
                        <span className="block leading-snug">{r.label}</span>
                        {r.note && <span className="block text-xs text-slate-blue/55 leading-snug mt-0.5">{r.note}</span>}
                      </span>
                      <svg className="w-3 h-3 text-gray-300 shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  ))}
                </div>
              ))}
    </>
  );
}

export function Header({ onToggleSidebar, sidebarOpen, searchBar, hideSidebarToggle = false, extraAction }: HeaderProps) {
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!resourcesOpen && !mobileMenuOpen) return;
    function handleClick(e: MouseEvent | TouchEvent) {
      const t = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(t)) setResourcesOpen(false);
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(t)) setMobileMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('touchstart', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick);
    };
  }, [resourcesOpen, mobileMenuOpen]);

  return (
    <header className="h-16 sm:h-[84px] bg-slate-blue flex items-center px-3 sm:px-4 z-50 relative shadow-md shrink-0">
      {!hideSidebarToggle && (
        <button
          onClick={onToggleSidebar}
          className="text-white/80 hover:text-white mr-3 p-1 rounded transition-colors"
          aria-label={sidebarOpen ? 'Close layers panel' : 'Open layers panel'}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {sidebarOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      )}

      <div className="flex items-center gap-3 shrink-0 min-w-0">
        <div className="min-w-0">
          <h1 className="text-white font-semibold text-sm sm:text-base leading-tight whitespace-nowrap">
            Salish Sea Explorer
          </h1>
          <p className="hidden sm:block text-white/50 text-xs leading-tight">
            Protect this Place&trade;
          </p>
        </div>
      </div>

      {searchBar && (
        <div className="flex-1 mx-2 sm:mx-4 max-w-lg min-w-0">
          {searchBar}
        </div>
      )}

      {/* Phones: Share and Resources live in one overflow menu */}
      <div ref={mobileMenuRef} className="relative sm:hidden ml-auto shrink-0">
        <button
          type="button"
          onClick={() => setMobileMenuOpen(o => !o)}
          aria-label="More"
          aria-expanded={mobileMenuOpen}
          className="w-9 h-9 flex items-center justify-center rounded text-white/80 hover:text-white hover:bg-white/10 transition-colors"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
          </svg>
        </button>
        {mobileMenuOpen && (
          <div className="absolute right-0 top-full mt-1 w-[19rem] max-w-[calc(100vw-1rem)] bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 max-h-[calc(100vh-7rem)] overflow-y-auto">
            {extraAction && <div className="px-2 py-1 [&_a]:text-slate-blue [&_a]:hover:text-deep-teal">{extraAction}</div>}
            <ShareButton variant="menu" onDone={() => setMobileMenuOpen(false)} />
            <ResourceList onPick={() => setMobileMenuOpen(false)} />
          </div>
        )}
      </div>

      <div className="ml-auto hidden sm:flex items-center gap-4 shrink-0">
        {extraAction}
        <ShareButton />
        {/* Resources dropdown */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setResourcesOpen(!resourcesOpen)}
            className="flex items-center gap-1.5 text-white/70 hover:text-white text-sm font-medium transition-colors px-2 py-1 rounded hover:bg-white/10"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            Resources
            <svg className={`w-3 h-3 transition-transform ${resourcesOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {resourcesOpen && (
            <div className="absolute right-0 top-full mt-1 w-[22rem] max-w-[calc(100vw-2rem)] bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50 max-h-[calc(100vh-7rem)] overflow-y-auto">
              <ResourceList onPick={() => setResourcesOpen(false)} />
            </div>
          )}
        </div>

        <img
          src="/friends-logo-white.webp"
          alt="Friends of the San Juans"
          className="h-11 hidden sm:block opacity-70"
        />
      </div>
    </header>
  );
}
