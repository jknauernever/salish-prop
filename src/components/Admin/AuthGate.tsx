import { useState, type ReactNode } from 'react';

const TOKEN_STORAGE_KEY = 'admin_token';

/**
 * Read the admin token from sessionStorage. Returns null if absent.
 * Module-level helper so other admin components (and the save endpoint)
 * can grab the token without re-reading state.
 */
export function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

export function clearAdminToken(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
}

interface AuthGateProps {
  children: ReactNode;
}

/**
 * Client-side login gate. Stores the entered password in sessionStorage
 * and renders children. The token is only really validated when the user
 * tries to save — the server is the source of truth. This gate exists
 * for UX (don't show the admin UI to anonymous visitors) and to provide
 * a place to store the token between page loads in the same tab.
 */
export function AuthGate({ children }: AuthGateProps) {
  const [token, setTokenState] = useState<string | null>(() => getAdminToken());
  const [draft, setDraft] = useState('');
  const [touched, setTouched] = useState(false);

  if (token) {
    return <>{children}</>;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!draft) return;
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, draft);
    setTokenState(draft);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-fog-gray px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white rounded-lg shadow-md border border-fog-gray-dark/40 p-6 space-y-4"
      >
        <div>
          <h1 className="text-lg font-semibold text-slate-blue">Admin sign-in</h1>
          <p className="text-sm text-slate-blue/60 mt-1">
            Salish Sea Explorer administration
          </p>
        </div>
        <div>
          <label htmlFor="admin-password" className="block text-xs font-medium text-slate-blue/70 mb-1">
            Password
          </label>
          <input
            id="admin-password"
            type="password"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-fog-gray-dark/60 bg-white text-sm text-slate-blue focus:outline-none focus:ring-2 focus:ring-deep-teal/40"
          />
          {touched && !draft && (
            <p className="text-xs text-red-600 mt-1">Password is required.</p>
          )}
        </div>
        <button
          type="submit"
          className="w-full bg-slate-blue text-white text-sm font-medium py-2 rounded-md hover:bg-slate-blue/90 transition-colors"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
