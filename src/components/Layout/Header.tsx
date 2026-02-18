import type { ReactNode } from 'react';

interface HeaderProps {
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  searchBar?: ReactNode;
}

export function Header({ onToggleSidebar, sidebarOpen, searchBar }: HeaderProps) {
  return (
    <header className="h-14 bg-slate-blue flex items-center px-4 z-50 relative shadow-md shrink-0">
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

      <div className="flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 rounded-full bg-deep-teal flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="hidden sm:block">
          <h1 className="text-white font-semibold text-base leading-tight">
            Salish Sea Explorer
          </h1>
          <p className="text-white/50 text-xs leading-tight">
            Protect this Place&trade;
          </p>
        </div>
      </div>

      {searchBar && (
        <div className="flex-1 mx-4 max-w-lg">
          {searchBar}
        </div>
      )}

      <div className="ml-auto text-white/40 text-xs hidden sm:block shrink-0">
        Friends of the San Juans
      </div>
    </header>
  );
}
