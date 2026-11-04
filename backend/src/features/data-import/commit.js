/**
 * Commit helpers: pure functions that decide what gets written, so every rule
 * is testable without a database. The service does the writing.
 */
const { startOfLocalDay } = require('../../utils/zonedTime');

/** A date from the sheet ("2026-10-13") as an instant in the org's timezone, never later than `now`. */
function instantOf(ymd, tz, now) {
  if (!ymd) return null;
  const at = startOfLocalDay(ymd, tz);
  return at > now ? now : at;
}

const STAGE_DATE = { lineup: 'lineup', interview: 'interview', joined: 'joining' };

/**
 * The stage history for one imported tracker.
 *
 * The product's numbers (stage entries, placements, stuck candidates, time to
 * place) all read the stage log, so history is written the way live use would
 * have written it: one log per stage walked, each closed as "advanced" when the
 * next opens, stamped with the dates the sheet gives. Stages the sheet gives no
 * date for take the previous stage's time; stages before the first known date
 * take that date. With no dates at all everything is "now". Nothing is dated
 * in the future, so an upcoming lineup enters its stage today.
 *
 * @param stages  the team's pipeline, any order: { id, stageKey, orderIndex, isFinalSuccess }
 * @returns { logs, status, firstAt, lastAt, downgraded }
 */
function buildStageLogs({ stages, targetKey, status, reason, dates = {}, tz, now = new Date(), movedBy = null, note = null }) {
  const sorted = [...stages].sort((a, b) => a.orderIndex - b.orderIndex);
  if (!sorted.length) throw new Error('The pipeline has no stages');
  let idx = sorted.findIndex((s) => s.stageKey === targetKey);
  if (idx < 0) idx = 0;
  const path = sorted.slice(0, idx + 1);
  const last = path[path.length - 1];

  let final = status || 'active';
  let downgraded = false;
  if (final === 'placed' && !last.isFinalSuccess) { final = 'active'; downgraded = true; } // cannot be "placed" without a final stage

  const known = ['lineup', 'interview', 'joining'].map((k) => instantOf(dates[k], tz, now)).filter(Boolean);
  const base = known.length ? known.reduce((a, b) => (a < b ? a : b)) : now;
  let prev = base;
  const at = path.map((s) => {
    const own = STAGE_DATE[s.stageKey] ? instantOf(dates[STAGE_DATE[s.stageKey]], tz, now) : null;
    prev = own && own > prev ? own : prev;     // never goes backwards
    return prev;
  });

  const logs = path.map((s, i) => {
    const entered = at[i];
    if (i < path.length - 1) return { stageId: s.id, status: 'advanced', enteredAt: entered, exitedAt: at[i + 1], movedBy, blockReason: null, notes: null };
    const open = final === 'active' || final === 'placed';
    const closed = { rejected: 'blocked', withdrawn: 'withdrawn', on_hold: 'held' }[final];
    return { stageId: s.id, status: open ? 'active' : closed, enteredAt: entered, exitedAt: open ? null : entered, movedBy,
      blockReason: final === 'rejected' || final === 'withdrawn' ? (reason || null) : null, notes: note };
  });
  return { logs, status: final, firstAt: at[0], lastAt: at[at.length - 1], downgraded };
}

/**
 * Lineups and interviews from today on that HR already mailed from their old
 * system. Logged as sent so the "needs sending" list does not ask for them again.
 * One log per client, hiring location, mail type and day, as the list groups them.
 *
 * @param items  { trackerId, clientId, locationId|null, lineupDay|null, interviewDay|null }
 */
function mailLogGroups(items, today) {
  const groups = new Map();
  for (const it of items) {
    if (!it.clientId) continue;
    for (const [mailType, day] of [['lineup', it.lineupDay], ['interview_schedule', it.interviewDay]]) {
      if (!day || day < today) continue;
      const key = [it.clientId, it.locationId || '', mailType, day].join('|');
      if (!groups.has(key)) groups.set(key, { clientId: it.clientId, locationId: it.locationId || null, mailType, day, trackerIds: [] });
      groups.get(key).trackerIds.push(it.trackerId);
    }
  }
  return [...groups.values()].sort((a, b) => a.day.localeCompare(b.day) || a.mailType.localeCompare(b.mailType));
}

/** Candidate custom fields under the names the rest of the product already reads (mail columns, submissions). */
function candidateCustomFields(candidate, custom) {
  const out = {};
  if (candidate.experienceYears !== null && candidate.experienceYears !== undefined) out.experience = String(candidate.experienceYears);
  const map = { currentCtc: 'current_ctc', expectedCtc: 'expected_ctc', noticePeriod: 'notice_period', qualification: 'qualification', currentEmployer: 'current_company' };
  for (const [from, to] of Object.entries(map)) if (custom && custom[from]) out[to] = custom[from];
  if (candidate.altPhone) out.alt_phone = candidate.altPhone;
  for (const [k, v] of Object.entries(custom || {})) if (!(k in map) && k !== 'resumeLink') out[k] = v; // the sheet's own extra columns
  return out;
}

module.exports = { buildStageLogs, mailLogGroups, candidateCustomFields, instantOf };
