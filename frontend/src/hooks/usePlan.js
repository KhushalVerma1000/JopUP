import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';

/**
 * The signed-in workspace's plan, trial and module access (GET /billing/usage),
 * cached for a minute and shared between components so the banner, the lock
 * cards and the dashboard make one request between them.
 *
 * `has(moduleKey)` answers true until the answer is known, so nothing flashes a
 * lock before the first response arrives. The API still enforces every module.
 */
const TTL_MS = 60 * 1000;
let cache = { key: null, at: 0, data: null, inflight: null };

export function invalidatePlan() {
  cache = { key: null, at: 0, data: null, inflight: null };
}

function load(key) {
  if (cache.key === key && cache.data && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.data);
  if (cache.key === key && cache.inflight) return cache.inflight;
  const inflight = apiFetch('/api/v1/billing/usage')
    .then((res) => { cache = { key, at: Date.now(), data: res.data, inflight: null }; return res.data; })
    .catch((err) => { if (cache.inflight === inflight) cache.inflight = null; throw err; });
  cache = { key, at: 0, data: cache.key === key ? cache.data : null, inflight };
  return inflight;
}

export function usePlan() {
  const { user, isPlatform } = useAuth();
  const key = user ? (user.id || user.email || 'me') : null;
  const enabled = Boolean(key) && !isPlatform;
  const [usage, setUsage] = useState(() => (enabled && cache.key === key ? cache.data : null));
  const [loading, setLoading] = useState(enabled && !usage);

  const reload = useCallback(async () => {
    if (!enabled) return;
    invalidatePlan();
    try { setUsage(await load(key)); } catch { /* the banner is optional: stay quiet */ }
  }, [enabled, key]);

  useEffect(() => {
    if (!enabled) { setUsage(null); setLoading(false); return undefined; }
    let live = true;
    load(key).then((d) => { if (live) setUsage(d); }).catch(() => {}).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [enabled, key]);

  const mods = usage?.modules;
  const has = useCallback((moduleKey) => (mods ? mods.enabled.includes(moduleKey) : true), [mods]);
  return { usage, loading, reload, has, preview: mods?.preview || null, locked: mods?.locked || [] };
}
