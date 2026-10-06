/**
 * Pure helpers for the performance module — no DB, no Express — so the rules
 * that decide what a number "means" live in exactly one place and are unit
 * tested. The frontend renders what these return; it does not re-derive it.
 */

const RECENT_POINTS = 8;

/** Where does `value` stand against the KPI target? Same thresholds for every KPI. */
function kpiHealth(value, target, direction = 'higher_better') {
  if (value === null || value === undefined) return { tone: 'default', label: 'No data yet' };
  if (target === null || target === undefined || target === 0) return { tone: 'default', label: 'No target set' };
  if (direction === 'lower_better') {
    if (value <= target) return { tone: 'good', label: 'On target' };
    return value <= target * 1.2 ? { tone: 'warn', label: 'Slightly over' } : { tone: 'bad', label: 'Over target' };
  }
  if (direction === 'target_exact') {
    const off = Math.abs(value - target) / Math.abs(target);
    if (off <= 0.05) return { tone: 'good', label: 'On target' };
    return off <= 0.15 ? { tone: 'warn', label: 'Close' } : { tone: 'bad', label: 'Off target' };
  }
  if (value >= target) return { tone: 'good', label: 'On target' };
  return value >= target * 0.8 ? { tone: 'warn', label: 'Slightly behind' } : { tone: 'bad', label: 'Behind target' };
}

/** Signed % change between two readings; null when it can't be computed. */
function changePct(previous, latest) {
  if (previous === null || previous === undefined || latest === null || latest === undefined || previous === 0) return null;
  return Math.round(((latest - previous) / Math.abs(previous)) * 1000) / 10;
}

/** Is the move good news for this KPI? null = neutral / unknown. */
function isImprovement(delta, direction) {
  if (delta === null || delta === 0) return null;
  if (direction === 'target_exact') return null;
  return direction === 'lower_better' ? delta < 0 : delta > 0;
}

/** Normalise 'YYYY-MM-DD' or any ISO datetime to 'YYYY-MM-DD' (UTC date). Null if unparseable. */
function toDateOnly(input) {
  if (!input) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const d = new Date(`${input}T00:00:00Z`);
    return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== input ? null : input;
  }
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const todayDate = (now = new Date()) => now.toISOString().slice(0, 10);

/** Label shown on a KPI trend when the caller doesn't supply one. */
function defaultPeriodLabel(frequency, dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const year = d.getUTCFullYear();
  if (frequency === 'daily') return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (frequency === 'quarterly') return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${year}`;
  if (frequency === 'weekly') {
    const jan1 = Date.UTC(year, 0, 1);
    return `W${Math.ceil(((d.getTime() - jan1) / 86_400_000 + new Date(jan1).getUTCDay() + 1) / 7)} ${year}`;
  }
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * "overdue" is a function of the due date, not something a person has to
 * remember to flip: an active goal past its due date IS overdue. Completed and
 * cancelled goals never become overdue.
 */
function effectiveGoalStatus(goal, now = new Date()) {
  if (goal.status !== 'active' && goal.status !== 'overdue') return goal.status;
  if (!goal.dueDate) return 'active';
  return goal.dueDate < todayDate(now) ? 'overdue' : 'active';
}

function daysUntil(dateStr, now = new Date()) {
  if (!dateStr) return null;
  return Math.round((Date.parse(`${dateStr}T00:00:00Z`) - Date.parse(`${todayDate(now)}T00:00:00Z`)) / 86_400_000);
}

function averageScore(scores) {
  const v = Object.values(scores || {}).map(Number).filter((n) => Number.isFinite(n));
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
}

module.exports = { RECENT_POINTS, kpiHealth, changePct, isImprovement, toDateOnly, todayDate, defaultPeriodLabel, effectiveGoalStatus, daysUntil, averageScore };
