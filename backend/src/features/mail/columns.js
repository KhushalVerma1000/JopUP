const { formatDay, formatTime } = require('../../services/email/templates/lineup');
const { outgoingStageLabel } = require('../../utils/stageLabels');

/**
 * Every column a tracker mail can show. A template stores only keys (and an
 * optional label override); what each key means lives here, in one place, so
 * the mail, the preview and the Excel-style table cannot disagree.
 *
 * Each resolver gets the enriched tracker plus { tz, candidate } and returns a
 * plain string ('' when there is nothing to show). Escaping is the renderer's
 * job — values here are raw.
 */
const CATALOGUE = [
  { key: 'candidate_name', label: 'Name', group: 'Candidate', get: (t) => t.candidateName || '' },
  { key: 'mobile', label: 'Mobile', group: 'Candidate', get: (t) => t.candidatePhone || '' },
  { key: 'email', label: 'Email', group: 'Candidate', get: (t, c) => c.candidate?.email || '' },
  { key: 'location', label: 'Location', group: 'Candidate', get: (t) => t.candidateLocation || '' },
  { key: 'position', label: 'Position', group: 'Role', get: (t) => t.openPositionDesignation || '' },
  { key: 'position_location', label: 'Job location', group: 'Role', get: (t) => t.openPositionLocation || '' },
  { key: 'client', label: 'Client', group: 'Role', get: (t) => t.clientName || '' },
  { key: 'lineup_date', label: 'Lineup date', group: 'Schedule', get: (t, c) => formatDay(t.lineupDate, c.tz) },
  { key: 'lineup_time', label: 'Lineup time', group: 'Schedule', get: (t, c) => formatTime(t.lineupDate, c.tz) },
  { key: 'interview_date', label: 'Interview date', group: 'Schedule', get: (t, c) => formatDay(t.interviewDate, c.tz) },
  { key: 'interview_time', label: 'Interview time', group: 'Schedule', get: (t, c) => formatTime(t.interviewDate, c.tz) },
  // Outgoing wording: Turn up is "Reached" in mails and group chats.
  { key: 'stage', label: 'Status', group: 'Progress', get: (t) => (t.currentStage ? outgoingStageLabel(t.currentStage.stageKey, t.currentStage.name) : '') },
  { key: 'status_note', label: 'Remarks', group: 'Progress', get: (t) => t.currentStageNote || '' },
  // Candidate profile details live in candidate.customFields — keyed by name.
  { key: 'cf:current_employer', label: 'Current employer', group: 'Profile', get: (t, c) => cf(c, 'current_employer') },
  { key: 'cf:current_ctc', label: 'Current CTC', group: 'Profile', get: (t, c) => cf(c, 'current_ctc') },
  { key: 'cf:expected_ctc', label: 'Expected CTC', group: 'Profile', get: (t, c) => cf(c, 'expected_ctc') },
  { key: 'cf:notice_period', label: 'Notice period', group: 'Profile', get: (t, c) => cf(c, 'notice_period') },
  { key: 'cf:experience', label: 'Experience', group: 'Profile', get: (t, c) => cf(c, 'experience') },
];

const FREE_CF = /^cf:[a-z0-9_]{1,40}$/;
const BY_KEY = new Map(CATALOGUE.map((c) => [c.key, c]));

function cf(ctx, name) {
  const v = ctx.candidate?.customFields?.[name];
  return v === undefined || v === null ? '' : String(v);
}

const isKnownKey = (key) => BY_KEY.has(key) || FREE_CF.test(key);

/** The catalogue as the UI needs it (no resolver functions). */
const describeCatalogue = () => CATALOGUE.map(({ key, label, group }) => ({ key, label, group }));

/** Turns a `cf:some_field` key nobody catalogued into "Some field". */
function labelFor(key, override) {
  if (override && String(override).trim()) return String(override).trim();
  const known = BY_KEY.get(key);
  if (known) return known.label;
  const raw = key.replace(/^cf:/, '').replace(/_/g, ' ');
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function resolveValue(key, tracker, ctx) {
  const known = BY_KEY.get(key);
  if (known) return known.get(tracker, ctx) || '';
  return cf(ctx, key.replace(/^cf:/, ''));
}

/** Columns used when no template is chosen — what the Phase 1 lineup mail showed. */
const DEFAULT_COLUMNS = [
  { key: 'candidate_name' }, { key: 'mobile' }, { key: 'position' }, { key: 'location' }, { key: 'lineup_time' },
];

module.exports = { CATALOGUE, DEFAULT_COLUMNS, isKnownKey, describeCatalogue, labelFor, resolveValue };
