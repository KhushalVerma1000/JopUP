/**
 * Helpers behind the HR "Today" view. Pure — no database — so the rules can be tested directly.
 *
 * A reschedule or an outcome (not coming / confirmed) is stored as one candidate_tracker_action
 * row with metadata.kind set; nothing new in the schema. The list API folds those rows into
 * three small fields per tracker so the screen can decide what still needs HR's attention.
 */

const KIND = { RESCHEDULE: 'reschedule', NOT_COMING: 'not_coming', CONFIRMED: 'confirmed' };
const OUTCOMES = [KIND.NOT_COMING, KIND.CONFIRMED];
const KINDS = Object.values(KIND);

const time = (d) => (d ? new Date(d).getTime() : null);

/** A move, not a first-time set: both the old and the new date exist and they differ. */
function isReschedule(before, after) {
  const a = time(before);
  const b = time(after);
  return a !== null && b !== null && !Number.isNaN(a) && !Number.isNaN(b) && a !== b;
}

/**
 * rows: { trackerId, performedAt, metadata }[] (any order).
 * Returns Map(trackerId -> { rescheduleCount, notComingAt, confirmedFor })
 *   rescheduleCount  how many times a lineup/interview date was moved
 *   notComingAt      when HR last marked the candidate "not coming" (ISO) or null
 *   confirmedFor     the day (YYYY-MM-DD) the candidate last confirmed for, or null.
 *                    "Latest word wins": a later not-coming clears it, a later confirmation clears not-coming.
 */
function summariseActions(rows) {
  const out = new Map();
  const sorted = [...rows].sort((x, y) => time(x.performedAt) - time(y.performedAt));
  for (const r of sorted) {
    const kind = r.metadata?.kind;
    if (!KINDS.includes(kind)) continue;
    if (!out.has(r.trackerId)) out.set(r.trackerId, { rescheduleCount: 0, notComingAt: null, confirmedFor: null });
    const s = out.get(r.trackerId);
    if (kind === KIND.RESCHEDULE) s.rescheduleCount += 1;
    else if (kind === KIND.NOT_COMING) { s.notComingAt = new Date(r.performedAt).toISOString(); s.confirmedFor = null; }
    else if (kind === KIND.CONFIRMED) { s.confirmedFor = r.metadata?.forDate || null; s.notComingAt = null; } // the latest word wins
  }
  return out;
}

const FIELD_LABEL = { lineupDate: 'Lineup date', interviewDate: 'Interview date' };

module.exports = { KIND, OUTCOMES, isReschedule, summariseActions, FIELD_LABEL };
