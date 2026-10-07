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

// ── periods ─────────────────────────────────────────────────────────────────
const { addDays } = require('../../utils/zonedTime');

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

/**
 * The KPI period containing local day `day` ('YYYY-MM-DD'): { start, end } where
 * end is EXCLUSIVE (the first day of the next period). Weeks start on Monday.
 */
function periodBounds(frequency, day) {
  const [y, m, d] = day.split('-').map(Number);
  if (frequency === 'daily') return { start: day, end: addDays(day, 1) };
  if (frequency === 'weekly') {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7; // Mon=1 … Sun=7
    const start = addDays(day, 1 - dow);
    return { start, end: addDays(start, 7) };
  }
  if (frequency === 'quarterly') {
    const qm = Math.floor((m - 1) / 3) * 3 + 1;
    return { start: ymd(y, qm, 1), end: qm + 3 > 12 ? ymd(y + 1, 1, 1) : ymd(y, qm + 3, 1) };
  }
  return { start: ymd(y, m, 1), end: m === 12 ? ymd(y + 1, 1, 1) : ymd(y, m + 1, 1) };
}

/** The `count` most recent periods ending with the one containing `day`, oldest first. */
function recentPeriods(frequency, day, count) {
  const out = [periodBounds(frequency, day)];
  while (out.length < count) out.unshift(periodBounds(frequency, addDays(out[0].start, -1)));
  return out;
}

/**
 * Read a strategy period like "Q4 2026", "H2 2026", "2026" or "Oct 2026" into
 * { start, end } (end INCLUSIVE). Returns null when it can't be read for certain
 * — "FY2026" in particular means different things in different countries, so we
 * ask for dates rather than guess.
 */
function parsePeriod(text) {
  const t = String(text || '').trim().toLowerCase();
  let m;
  if ((m = t.match(/^q([1-4])\s*[-/ ]?\s*(\d{4})$/))) {
    const q = Number(m[1]); const y = Number(m[2]);
    const startM = (q - 1) * 3 + 1;
    return { start: ymd(y, startM, 1), end: addDays(startM + 3 > 12 ? ymd(y + 1, 1, 1) : ymd(y, startM + 3, 1), -1) };
  }
  if ((m = t.match(/^h([12])\s*[-/ ]?\s*(\d{4})$/))) {
    const y = Number(m[2]);
    return m[1] === '1' ? { start: ymd(y, 1, 1), end: ymd(y, 6, 30) } : { start: ymd(y, 7, 1), end: ymd(y, 12, 31) };
  }
  if ((m = t.match(/^(\d{4})$/))) return { start: ymd(+m[1], 1, 1), end: ymd(+m[1], 12, 31) };
  if ((m = t.match(/^([a-z]{3})[a-z]*\.?\s+(\d{4})$/)) && MONTHS.includes(m[1])) {
    const mo = MONTHS.indexOf(m[1]) + 1; const y = Number(m[2]);
    return { start: ymd(y, mo, 1), end: addDays(mo === 12 ? ymd(y + 1, 1, 1) : ymd(y, mo + 1, 1), -1) };
  }
  return null;
}

const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

// ── progress & pacing ───────────────────────────────────────────────────────
/** 0-100 progress of `current` towards `target`, honouring direction. null = can't tell. */
function progressPct(current, target, direction = 'higher_better') {
  if (current === null || current === undefined || target === null || target === undefined) return null;
  let p;
  if (direction === 'lower_better') {
    if (current <= target) p = 100;
    else if (current <= 0) p = 100;
    else p = (target / current) * 100;
  } else if (direction === 'target_exact') {
    if (target === 0) return null;
    p = 100 - (Math.abs(current - target) / Math.abs(target)) * 100;
  } else {
    if (target === 0) return null;
    p = (current / target) * 100;
  }
  return Math.max(0, Math.min(100, Math.round(p)));
}

/**
 * Is this key result on course? Cumulative counts ("place 40 candidates") are
 * judged against how much of the period has elapsed; rates, durations and
 * snapshots are judged against the target itself, like a KPI.
 */
function krStatus({ progress, current, target, direction, pacing }, window, today) {
  if (progress === null || progress === undefined) return 'no_data';
  const { start, end } = window || {};
  if (start && today < start) return 'not_started';
  const over = end ? today > end : false;
  if (pacing && start && end) {
    if (progress >= 100) return 'achieved';
    if (over) return 'missed';
    const total = dayDiff(start, end) + 1;
    const elapsed = Math.max(1, dayDiff(start, today) + 1);
    if (elapsed / total < 0.1) return 'just_started';   // too early for a count to say anything
    const ratio = progress / ((elapsed / total) * 100);
    return ratio >= 0.9 ? 'on_track' : ratio >= 0.6 ? 'at_risk' : 'off_track';
  }
  const tone = kpiHealth(current, target, direction).tone;
  if (over) return tone === 'good' ? 'achieved' : 'missed';
  return tone === 'good' ? 'on_track' : tone === 'warn' ? 'at_risk' : tone === 'bad' ? 'off_track' : 'no_data';
}

const mean = (values) => {
  const v = values.filter((x) => x !== null && x !== undefined);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
};

module.exports = { RECENT_POINTS, periodBounds, recentPeriods, parsePeriod, dayDiff, progressPct, krStatus, mean, kpiHealth, changePct, isImprovement, toDateOnly, todayDate, defaultPeriodLabel, effectiveGoalStatus, daysUntil, averageScore };
