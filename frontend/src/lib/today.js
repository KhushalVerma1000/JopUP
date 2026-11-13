// Today view for HR: which candidates need attention now.
//
// Pure functions, no React, so the rules can be tested directly. "Day" is always the HR's own
// local calendar day, the same as the rest of the workbench (see lineupDay.js).
//
// Buckets, one row per candidate (a candidate never appears twice):
//   late      a lineup/interview date has passed, the candidate hasn't moved on, and HR hasn't
//             recorded an answer yet. A no-show is where tracker data goes stale.
//   today     lineup or interview is today
//   tomorrow  lineup or interview is tomorrow: the list to confirm on WhatsApp
//   quiet     no stage movement for QUIET_DAYS or more and nothing dated coming up
//
// A date only counts while it can still happen, decided from the stable stageKey:
//   lineup date      until the candidate has reached (stage Turn up or later)
//   interview date   until the interview is done (stage Offer or later)
// A stage with another key never raises a late alarm.
import { dayKey, timeKey } from './lineupDay.js';

export const QUIET_DAYS = 5;
export const QUIET_LIST_MAX = 10;

const LINEUP_OPEN = ['applied', 'screening', 'lineup'];
const INTERVIEW_OPEN = ['applied', 'screening', 'lineup', 'turnup', 'interview'];
const AFTER_REACHED = ['turnup', 'interview'];
const RANK = { late: 0, today: 1, tomorrow: 2 };

export function dayOffset(now, n) {
  return dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
}

const dayNumber = (key) => { const [y, m, d] = key.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
export const daysBetween = (fromKey, toKey) => dayNumber(toKey) - dayNumber(fromKey);

function openEvents(t) {
  const stage = t.currentStage?.stageKey;
  const events = [];
  if (t.lineupDate && LINEUP_OPEN.includes(stage)) events.push({ kind: 'lineup', field: 'lineupDate', date: t.lineupDate });
  if (t.interviewDate && INTERVIEW_OPEN.includes(stage)) events.push({ kind: 'interview', field: 'interviewDate', date: t.interviewDate });
  return events;
}

/** Of several events in the same bucket, the one the candidate is actually at. */
function pickEvent(t, events) {
  if (events.length === 1) return events[0];
  const wanted = AFTER_REACHED.includes(t.currentStage?.stageKey) ? 'interview' : 'lineup';
  return events.find((e) => e.kind === wanted) || events[0];
}

const byTime = (a, b) => (timeKey(a.date) || '99:99').localeCompare(timeKey(b.date) || '99:99') || String(a.tracker.candidateName).localeCompare(String(b.tracker.candidateName));

export function buildToday(trackers, now = new Date()) {
  const today = dayOffset(now, 0);
  const tomorrow = dayOffset(now, 1);
  const out = { late: [], today: [], tomorrow: [], quiet: [], quietTotal: 0 };
  const placed = new Set();

  for (const t of trackers) {
    if (t.status !== 'active') continue;
    const candidates = [];
    let waitingAhead = false;
    for (const e of openEvents(t)) {
      const day = dayKey(e.date);
      if (!day) continue;
      if (day < today) {
        // Already answered ("not coming" on or after that day): nothing left for HR to do.
        if (t.notComingAt && dayKey(t.notComingAt) >= day) continue;
        candidates.push({ ...e, bucket: 'late', day, daysLate: daysBetween(day, today) });
      } else if (day === today) {
        candidates.push({ ...e, bucket: 'today', day, handled: !!t.notComingAt && dayKey(t.notComingAt) >= day });
      } else if (day === tomorrow) {
        candidates.push({ ...e, bucket: 'tomorrow', day, confirmed: t.confirmedFor === day, handled: !!t.notComingAt && dayKey(t.notComingAt) >= day });
      } else waitingAhead = true;
    }
    if (candidates.length) {
      const bucket = Object.keys(RANK).find((b) => candidates.some((c) => c.bucket === b)); // late, then today, then tomorrow
      const item = pickEvent(t, candidates.filter((c) => c.bucket === bucket));
      out[bucket].push({ tracker: t, ...item });
      placed.add(t.id);
      continue;
    }
    if (waitingAhead || t.currentStage?.isFinalSuccess) continue;
    // Quiet: has sat in this stage for QUIET_DAYS or more, with nothing dated coming up.
    const since = t.currentStageEnteredAt ? dayKey(t.currentStageEnteredAt) : '';
    const idle = since ? daysBetween(since, today) : 0;
    if (idle >= QUIET_DAYS) out.quiet.push({ tracker: t, idleDays: idle });
  }

  out.late.sort((a, b) => b.daysLate - a.daysLate || byTime(a, b));
  out.today.sort(byTime);
  out.tomorrow.sort(byTime);
  out.quiet.sort((a, b) => b.idleDays - a.idleDays);
  out.quietTotal = out.quiet.length;
  out.quiet = out.quiet.slice(0, QUIET_LIST_MAX);
  return out;
}

const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

/** The WhatsApp message for a row. HR still presses send. The client's name is left out on purpose. */
export function whatsappText(item) {
  const t = item.tracker;
  const role = t.openPositionDesignation ? ` for the ${t.openPositionDesignation} role` : '';
  if (item.bucket === 'tomorrow') {
    const what = item.kind === 'interview' ? 'interview' : 'line-up';
    const at = timeKey(item.date) ? ` at ${new Date(item.date).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}` : '';
    return `Hi ${first(t.candidateName)}, a quick reminder about your ${what} tomorrow${at}${role}. Please confirm you'll be there.`;
  }
  if (item.bucket === 'late' || item.bucket === 'today') {
    return `Hi ${first(t.candidateName)}, we were expecting you for your ${item.kind === 'interview' ? 'interview' : 'line-up'}${role}. Are you still able to come? Let us know and we can set a new time.`;
  }
  return `Hi ${first(t.candidateName)}, just checking in on your application${role}. Are you still interested?`;
}
