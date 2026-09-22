import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiFetch, getToken, setToken, ApiError } from '../lib/api';

const AuthContext = createContext(null);

/**
 * Role objects from the API come in two slightly different shapes depending
 * on where they came from (both confirmed against the actual backend code):
 *   - POST /auth/login's data.roles:  { teamId, roleName, scope, permissions }
 *   - GET  /auth/me's  data.roles:    { teamId, roleName, permissions }        (no `scope` — this is the JWT payload, which strips it)
 * Never rely on `scope` being present. To check "is this an org-wide
 * org_admin role" (not a team-scoped one), mirror exactly what the backend
 * itself checks in middlewares/requireAuth.js's requireOrgRole: roleName
 * matches AND teamId is null/undefined.
 */
function hasOrgRole(roles, roleName) {
  return (roles || []).some(
    (r) => r.roleName === roleName && (r.teamId === null || r.teamId === undefined)
  );
}

function hasAnyRole(roles, roleName) {
  return (roles || []).some((r) => r.roleName === roleName);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [roles, setRoles] = useState([]);
  // Distinguishes "haven't checked yet" from "checked, not logged in" — a
  // ProtectedRoute needs this to avoid redirecting to /login for a split
  // second on every page load while the /auth/me check is in flight.
  const [initializing, setInitializing] = useState(true);

  const clearSession = useCallback(() => {
    setToken(null);
    setUser(null);
    setRoles([]);
  }, []);

  // On first load, if a token is already stored (from a previous session),
  // re-hydrate the user from GET /auth/me rather than trusting the token's
  // own payload — the token could be stale (e.g. the account was suspended
  // since it was issued), and /auth/me always reflects current DB state.
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setInitializing(false);
      return;
    }
    apiFetch('/api/v1/auth/me')
      .then((res) => {
        setUser(res.data.user);
        setRoles(res.data.roles);
      })
      .catch(() => {
        // Expired/invalid token — drop it silently and fall back to logged-out.
        clearSession();
      })
      .finally(() => setInitializing(false));
  }, [clearSession]);

  const login = useCallback(async (organisationSlug, email, password) => {
    const res = await apiFetch('/api/v1/auth/login', {
      method: 'POST',
      body: { organisationSlug, email, password },
    });
    setToken(res.data.token);
    setUser(res.data.user);
    setRoles(res.data.roles);
    return res.data.user;
  }, []);

  const register = useCallback(async (fields) => {
    // Self-service registration always lands as 'pending_approval' — there
    // is no token to store here, the caller can't log in until a manager
    // or org_admin approves the request (see backend/src/features/auth).
    return apiFetch('/api/v1/auth/register', { method: 'POST', body: fields });
  }, []);

  const logout = useCallback(() => {
    clearSession();
  }, [clearSession]);

  const value = {
    user,
    roles,
    initializing,
    isAuthenticated: !!user,
    isOrgAdmin: hasOrgRole(roles, 'org_admin'),
    isManager: hasAnyRole(roles, 'manager'),
    isHr: hasAnyRole(roles, 'hr'),
    login,
    register,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an <AuthProvider>');
  return ctx;
}

export { ApiError };
