import { useState } from 'react';
import { DEFAULT_PROVIDER, isProvider } from '../lib/composeLinks';

const storageKey = (userId) => `jopup.mailProvider.${userId || 'anon'}`;

function read(userId) {
  try {
    const saved = localStorage.getItem(storageKey(userId));
    return isProvider(saved) ? saved : DEFAULT_PROVIDER;
  } catch {
    return DEFAULT_PROVIDER;
  }
}

/**
 * Which mail service "Open in …" uses for this user. Remembered per user in this browser. Read once on mount: every screen that uses it sits behind login, so the user id is already known.
 * The only place that knows where it is stored: moving it to a users column later
 * (so it follows the user across devices) is a change to this file alone.
 */
export function useMailProvider(userId) {
  const [provider, setProvider] = useState(() => read(userId));
  const update = (next) => {
    if (!isProvider(next)) return;
    setProvider(next);
    try { localStorage.setItem(storageKey(userId), next); } catch { /* private mode: keep it for this session only */ }
  };
  return [provider, update];
}
