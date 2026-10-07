// Display helpers for KPI screens. What a number *means* (health, trend,
// overdue…) is decided by the API; this file only formats it.

export const FREQUENCY_LABEL = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly' };
export const DIRECTION_LABEL = {
  higher_better: 'Higher is better',
  lower_better: 'Lower is better',
  target_exact: 'Hit the target exactly',
};

export function formatValue(value, unit) {
  if (value === null || value === undefined) return '—';
  const n = Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (!unit) return n;
  if (unit === '%') return `${n}%`;
  if (unit === '₹') return `₹${n}`;
  return `${n} ${unit}`;
}

/** YYYY-MM-DD for <input type="date">, in the browser's local day. */
export const todayInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const TONE_TEXT = {
  good: 'text-emerald-700 dark:text-emerald-400',
  warn: 'text-amber-700 dark:text-amber-400',
  bad: 'text-destructive',
  default: 'text-muted-foreground',
};

// Key-result status, decided by the API; this only words and colours it.
export const KR_STATUS = {
  achieved: { label: 'Achieved', tone: 'good' },
  on_track: { label: 'On track', tone: 'good' },
  at_risk: { label: 'At risk', tone: 'warn' },
  off_track: { label: 'Off track', tone: 'bad' },
  missed: { label: 'Missed', tone: 'bad' },
  just_started: { label: 'Just started', tone: 'default' },
  not_started: { label: 'Not started', tone: 'default' },
  no_data: { label: 'No data yet', tone: 'default' },
};
