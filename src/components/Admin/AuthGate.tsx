import { useState, type ReactNode } from 'react';

const TOKEN_STORAGE_KEY = 'admin_token';

/**
 * Read the admin token from sessionStorage. Returns null if absent.
 * Module-level helper so other admin components can grab the token
 * without re-reading state.
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
 * Login gate that verifies the password against the server before granting
 * access. Submits POST /api/admin/categories?verify=1 with the X-Admin-Token
 * header; on 204 we store the token and reveal the admin UI, on 401 we
 * surface a "Try again" error and keep the gate up. Tokens already present
 * in sessionStorage (from a previous successful sign-in this tab) are
 * trusted — the next API call will hit a real 401 if anything has changed.
 */
export function AuthGate({ children }: AuthGateProps) {
  const [token, setTokenState] = useState<string | null>(() => getAdminToken());
  const [draft, setDraft] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (token) {
    return <>{children}</>;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!draft) {
      setErrorMsg('Enter the admin password.');
      return;
    }
    setVerifying(true);
    try {
      const res = await fetch('/api/admin/categories?verify=1', {
        method: 'POST',
        headers: { 'X-Admin-Token': draft },
      });
      if (res.status === 204) {
        window.sessionStorage.setItem(TOKEN_STORAGE_KEY, draft);
        setTokenState(draft);
        return;
      }
      if (res.status === 401) {
        setErrorMsg('Incorrect password. Try again.');
        setDraft('');
        return;
      }
      setErrorMsg(`Sign-in failed (HTTP ${res.status}).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setVerifying(false);
    }
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
            autoComplete="current-password"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (errorMsg) setErrorMsg(null);
            }}
            disabled={verifying}
            className="w-full px-3 py-2 rounded-md border border-fog-gray-dark/60 bg-white text-sm text-slate-blue focus:outline-none focus:ring-2 focus:ring-deep-teal/40 disabled:opacity-60"
          />
          {errorMsg && (
            <p className="text-xs text-red-600 mt-1.5">{errorMsg}</p>
          )}
        </div>
        <button
          type="submit"
          disabled={verifying}
          className="w-full bg-slate-blue text-white text-sm font-medium py-2 rounded-md hover:bg-slate-blue/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {verifying ? 'Verifying…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
