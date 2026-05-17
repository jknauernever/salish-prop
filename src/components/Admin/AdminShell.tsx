import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { clearAdminToken } from './AuthGate';

interface ModuleEntry {
  to: string;
  label: string;
  enabled: boolean;
}

const MODULES: ModuleEntry[] = [
  { to: '/admin/categories', label: 'Categories', enabled: true },
  // Future modules:
  // { to: '/admin/layers', label: 'Layers', enabled: false },
  // { to: '/admin/users', label: 'Users', enabled: false },
];

export function AdminShell() {
  const navigate = useNavigate();

  function handleSignOut() {
    clearAdminToken();
    navigate('/admin');
    // Force a re-evaluation of the AuthGate (which reads from sessionStorage on mount)
    window.location.reload();
  }

  return (
    <div className="min-h-screen flex flex-col bg-fog-gray">
      <header className="h-14 bg-slate-blue text-white flex items-center px-4 shrink-0">
        <Link to="/admin" className="font-semibold tracking-tight hover:text-white/90">
          Salish Sea Admin
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <Link
            to="/"
            className="text-xs text-white/70 hover:text-white transition-colors px-2 py-1 rounded hover:bg-white/10"
          >
            ← View public map
          </Link>
          <button
            onClick={handleSignOut}
            className="text-xs text-white/70 hover:text-white transition-colors px-2 py-1 rounded hover:bg-white/10"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="flex-1 flex">
        <aside className="w-56 bg-white border-r border-fog-gray-dark/40 shrink-0">
          <nav className="p-3 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-blue/40 px-2 mb-1">
              Modules
            </p>
            {MODULES.map((m) =>
              m.enabled ? (
                <NavLink
                  key={m.to}
                  to={m.to}
                  className={({ isActive }) =>
                    `block px-2 py-1.5 rounded-md text-sm transition-colors ${
                      isActive
                        ? 'bg-deep-teal text-white'
                        : 'text-slate-blue hover:bg-fog-gray/60'
                    }`
                  }
                >
                  {m.label}
                </NavLink>
              ) : (
                <span
                  key={m.to}
                  className="block px-2 py-1.5 rounded-md text-sm text-slate-blue/30 cursor-not-allowed"
                >
                  {m.label}
                </span>
              )
            )}
          </nav>
        </aside>

        <main className="flex-1 p-6 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/**
 * Placeholder shown at /admin (no module selected).
 */
export function AdminHome() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-slate-blue mb-2">Admin home</h1>
      <p className="text-sm text-slate-blue/70">
        Pick a module from the left to begin. More modules will appear here over time.
      </p>
    </div>
  );
}

