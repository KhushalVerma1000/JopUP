// Thin fetch wrapper for the JopUP API.
//
// Uses relative paths (`/api/v1/...`) rather than an absolute URL, so this
// works unchanged whether Vite's dev proxy (see vite.config.js) forwards to
// the Dockerized backend on localhost:3000, or the built frontend is later
// served from the same origin as the API in production. If the frontend
// ever ends up on a genuinely different origin than the API (no proxy, no
// same-origin serving), the backend will need CORS added — it doesn't have
// any today (confirmed: no `cors` package in backend/package.json).

const TOKEN_KEY = 'jopup_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * @param {string} path e.g. '/api/v1/auth/login'
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {object} [options.body]
 */
export async function apiFetch(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Every JopUP error response is { status: 'fail', message: '...' } —
  // confirmed in backend/src/middlewares/errorHandler.js.
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // A non-JSON response (e.g. a proxy error page) — fall through and
    // let the !res.ok branch below raise something reasonable.
  }

  if (!res.ok) {
    const message = payload?.message || `Request failed (${res.status})`;
    throw new ApiError(message, res.status, payload);
  }

  return payload;
}
