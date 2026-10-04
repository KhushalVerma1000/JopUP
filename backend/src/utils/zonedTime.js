/**
 * Time-zone helpers for the daily tracker, built on Intl (no dependency).
 * "Today" for a tracker is the LOCAL calendar day in the schedule's zone, so a
 * Mumbai agency's 6 pm tracker covers its own day, not UTC's.
 */

function assertTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; }
  catch { throw new RangeError(`Unknown time zone '${tz}'`); }
}

/** Wall-clock parts of an instant in `tz`. isoWeekday: Mon=1 … Sun=7. */
function localParts(date, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  const isoWeekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[parts.weekday];
  return {
    year: +parts.year, month: +parts.month, day: +parts.day,
    hour: +parts.hour, minute: +parts.minute, second: +parts.second, isoWeekday,
  };
}

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' of the local calendar day containing `date`. */
function localDate(date, tz) {
  const p = localParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Offset (ms) of `tz` from UTC at the given instant: local wall clock − UTC. */
function offsetMs(date, tz) {
  const p = localParts(date, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

/** The UTC instant at which the local wall clock reads `ymd` 00:00. DST-safe. */
function startOfLocalDay(ymd, tz) {
  const [y, m, d] = ymd.split('-').map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d);
  let guess = wallAsUtc - offsetMs(new Date(wallAsUtc), tz);
  // The offset at the guess can differ from the offset at midnight itself (DST
  // changeover between them), so refine once.
  guess = wallAsUtc - offsetMs(new Date(guess), tz);
  return new Date(guess);
}

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** [start, end) of the local day — 23 or 25 hours long on DST days. */
function localDayBounds(ymd, tz) {
  return { start: startOfLocalDay(ymd, tz), end: startOfLocalDay(addDays(ymd, 1), tz) };
}

/**
 * Is this schedule due right now? Due = today (local) is a send day AND the
 * local clock has reached sendTime. Deliberately NOT "within the minute of
 * sendTime": a server that was down at 18:00 still sends at 18:20, because the
 * tracker is for today and today isn't over. Idempotency is the run table's job.
 */
function isDue(now, { sendTime, sendDays }, tz) {
  const p = localParts(now, tz);
  if (!sendDays.includes(p.isoWeekday)) return false;
  const [h, m] = sendTime.split(':').map(Number);
  return p.hour * 60 + p.minute >= h * 60 + m;
}

module.exports = { assertTimeZone, localParts, localDate, localDayBounds, startOfLocalDay, addDays, isDue };
