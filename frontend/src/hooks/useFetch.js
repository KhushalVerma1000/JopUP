import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, ApiError } from '../lib/api';

/**
 * GET a path and keep { data, loading, error, reload } in sync. `path` may be
 * null/undefined to skip fetching (e.g. until a filter is ready). Changing
 * the path refetches; stale responses from an earlier path are dropped.
 */
export function useFetch(path) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState(null);
  const seq = useRef(0);

  const run = useCallback(async () => {
    if (!path) { setData(null); setLoading(false); return; }
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(path);
      if (mine === seq.current) setData(res.data);
    } catch (err) {
      if (mine === seq.current) setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => { run(); }, [run]);

  return { data, loading, error, reload: run };
}

export function errorMessage(err, fallback = 'Something went wrong. Please try again.') {
  return err instanceof ApiError ? err.message : fallback;
}
