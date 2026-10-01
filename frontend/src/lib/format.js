export function formatMoney(value, currency = 'INR') {
  const n = Number(value || 0);
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
}

export function compact(n) {
  return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n || 0));
}

/** "3d ago", "just now", "in 2d" — coarse on purpose, good enough for a glance. */
export function relativeTime(input) {
  if (!input) return 'never';
  const then = new Date(input).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = then - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const label = mins < 1 ? 'just now' : mins < 60 ? `${mins}m` : hours < 24 ? `${hours}h` : `${days}d`;
  if (label === 'just now') return label;
  return diff < 0 ? `${label} ago` : `in ${label}`;
}

export function daysUntil(input) {
  if (!input) return null;
  return Math.ceil((new Date(input).getTime() - Date.now()) / 86400000);
}

export function shortDate(input) {
  if (!input) return '—';
  return new Date(input).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function fullName(p) {
  return [p?.firstName, p?.lastName].filter(Boolean).join(' ');
}

export function initials(name) {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}
