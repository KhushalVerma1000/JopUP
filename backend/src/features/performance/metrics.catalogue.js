/**
 * The metric catalogue: every number that KPIs, goals and strategy key results
 * can be measured by, defined ONCE, computed from the live pipeline
 * (candidate_tracker, its stage log, its actions, open positions).
 *
 * Rules that make the numbers trustworthy:
 *   - Placement date  = when the tracker first entered a final-success stage
 *                       (a placed tracker has no placed_at column — the stage log is the truth).
 *   - Attribution     = the tracker's assigned_hr owns placements, stage moves and
 *                       pipeline counts; calls / activities belong to whoever performed them.
 *   - Window          = [from, to) as instants; callers turn org-local dates into instants.
 *   - kind 'flow'     = something that happened inside the window (recomputable for any past window).
 *   - kind 'snapshot' = the state of the pipeline right now (cannot be recomputed for the past, so a
 *                       closed period keeps the last value it had).
 *   - cumulative      = a count that only grows inside a window, so progress is judged against the
 *                       time elapsed and a goal on it completes the moment it reaches target.
 *
 * Adding a metric = adding one entry here. Nothing else needs to change.
 */
// Loaded lazily so the catalogue (names, units, directions) can be used by validation
// code and tests without a database connection.
const db = { execute: (q) => require('../../utils/db').db.execute(q) };
const { sql } = require('drizzle-orm');

const num = (v) => (v === null || v === undefined ? null : Number(v));
const round1 = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
const STUCK_AFTER_DAYS = 5;

/** Shared WHERE for tracker-based metrics: org + team (+ owner). */
const trackerScope = (c) => sql`ct.organisation_id = ${c.orgId} and ct.team_id = ${c.teamId} ${c.userId ? sql`and ct.assigned_hr = ${c.userId}` : sql``}`;

/** distinct trackers that entered stage `stageKey` inside the window */
async function stageEntered(c, stageKey) {
  const { rows } = await db.execute(sql`
    select count(distinct l.tracker_id) as n
    from candidate_tracker ct
    join candidate_tracker_stage_log l on l.tracker_id = ct.id
    join workflow_stage s on s.id = l.stage_id
    where ${trackerScope(c)} and s.stage_key = ${stageKey}
      and l.entered_at >= ${c.from}::timestamptz and l.entered_at < ${c.to}::timestamptz`);
  return Number(rows[0].n);
}

/** placed trackers whose placement date falls inside the window */
async function placedInWindow(c) {
  const { rows } = await db.execute(sql`
    select count(*) as n,
           avg(extract(epoch from (p.placed_at - p.created_at)) / 86400) as avg_days
    from (
      select ct.id, ct.created_at, min(l.entered_at) as placed_at
      from candidate_tracker ct
      join candidate_tracker_stage_log l on l.tracker_id = ct.id
      join workflow_stage s on s.id = l.stage_id and s.is_final_success = true
      where ${trackerScope(c)} and ct.status = 'placed'
      group by ct.id, ct.created_at
    ) p
    where p.placed_at >= ${c.from}::timestamptz and p.placed_at < ${c.to}::timestamptz`);
  return { n: Number(rows[0].n), avgDays: num(rows[0].avg_days) };
}

async function rejectedInWindow(c) {
  const { rows } = await db.execute(sql`
    select count(*) as n from candidate_tracker ct
    where ${trackerScope(c)} and ct.status = 'rejected'
      and ct.updated_at >= ${c.from}::timestamptz and ct.updated_at < ${c.to}::timestamptz`);
  return Number(rows[0].n);
}

async function actionsInWindow(c, actionType) {
  const { rows } = await db.execute(sql`
    select count(*) as n
    from candidate_tracker_action a
    join candidate_tracker_stage_log l on l.id = a.stage_log_id
    join candidate_tracker ct on ct.id = l.tracker_id
    where ct.organisation_id = ${c.orgId} and ct.team_id = ${c.teamId}
      ${c.userId ? sql`and a.performed_by = ${c.userId}` : sql``}
      ${actionType ? sql`and a.action_type = ${actionType}` : sql`and a.action_type <> 'status_changed'`}
      and a.performed_at >= ${c.from}::timestamptz and a.performed_at < ${c.to}::timestamptz`);
  return Number(rows[0].n);
}

async function positionTotals(c) {
  const { rows } = await db.execute(sql`
    select coalesce(sum(op.vacancies), 0) as vacancies,
           coalesce(sum(least(coalesce(p.placed, 0), op.vacancies)), 0) as filled
    from open_position op
    left join lateral (select count(*) as placed from candidate_tracker x where x.open_position_id = op.id and x.status = 'placed') p on true
    where op.organisation_id = ${c.orgId} and op.team_id = ${c.teamId} and op.status = 'open'`);
  return { vacancies: Number(rows[0].vacancies), filled: Number(rows[0].filled) };
}

const flowCount = (key, label, description, fn, extra = {}) => ({
  key, label, unit: 'count', direction: 'higher_better', kind: 'flow', cumulative: true, userScope: true, description, compute: fn, ...extra,
});

const METRICS = [
  // ── Pipeline activity (counts that accumulate over a period) ──────────────
  flowCount('candidates_added', 'Candidates added', 'Candidates put into the pipeline.', async (c) => {
    const { rows } = await db.execute(sql`select count(*) as n from candidate_tracker ct where ${trackerScope(c)} and ct.created_at >= ${c.from}::timestamptz and ct.created_at < ${c.to}::timestamptz`);
    return Number(rows[0].n);
  }),
  flowCount('screenings', 'Screenings', 'Candidates who reached the Screening stage.', (c) => stageEntered(c, 'screening')),
  flowCount('lineups', 'Line-ups', 'Candidates lined up for the client.', (c) => stageEntered(c, 'lineup')),
  flowCount('turn_ups', 'Turn-ups', 'Candidates who turned up.', (c) => stageEntered(c, 'turnup')),
  flowCount('interviews', 'Interviews', 'Candidates who reached the Interview stage.', (c) => stageEntered(c, 'interview')),
  flowCount('offers', 'Offers', 'Candidates who reached the Offer stage.', (c) => stageEntered(c, 'offer')),
  flowCount('placements', 'Placements', 'Candidates placed (counted on the day they joined).', async (c) => (await placedInWindow(c)).n),
  flowCount('calls_made', 'Calls made', 'Call logs recorded against candidates.', (c) => actionsInWindow(c, 'call_log')),
  flowCount('activities_logged', 'Activities logged', 'Calls, emails, notes, interviews and other actions logged.', (c) => actionsInWindow(c, null)),

  // ── Rates & durations ─────────────────────────────────────────────────────
  {
    key: 'win_rate', label: 'Win rate', unit: '%', direction: 'higher_better', kind: 'flow', cumulative: false, userScope: true,
    description: 'Placed ÷ (placed + rejected) among candidates whose outcome landed in the period.',
    async compute(c) {
      const [placed, rejected] = await Promise.all([placedInWindow(c), rejectedInWindow(c)]);
      const closed = placed.n + rejected;
      return closed > 0 ? Math.round((placed.n / closed) * 100) : null;
    },
  },
  {
    key: 'turn_up_rate', label: 'Turn-up rate', unit: '%', direction: 'higher_better', kind: 'flow', cumulative: false, userScope: true,
    description: 'Turn-ups ÷ line-ups in the period.',
    async compute(c) {
      const [lineups, turnUps] = await Promise.all([stageEntered(c, 'lineup'), stageEntered(c, 'turnup')]);
      return lineups > 0 ? Math.min(100, Math.round((turnUps / lineups) * 100)) : null;
    },
  },
  {
    key: 'avg_days_to_place', label: 'Average days to place', unit: 'days', direction: 'lower_better', kind: 'flow', cumulative: false, userScope: true,
    description: 'Days from a candidate entering the pipeline to joining, for placements in the period.',
    async compute(c) { return round1((await placedInWindow(c)).avgDays); },
  },

  // ── Pipeline health right now ─────────────────────────────────────────────
  {
    key: 'active_pipeline', label: 'Active candidates', unit: 'count', direction: 'higher_better', kind: 'snapshot', cumulative: false, userScope: true,
    description: 'Candidates currently moving through the pipeline.',
    async compute(c) {
      const { rows } = await db.execute(sql`select count(*) as n from candidate_tracker ct where ${trackerScope(c)} and ct.status = 'active'`);
      return Number(rows[0].n);
    },
  },
  {
    key: 'stuck_candidates', label: 'Stuck candidates', unit: 'count', direction: 'lower_better', kind: 'snapshot', cumulative: false, userScope: true,
    description: `Active candidates who have sat in one stage for more than ${STUCK_AFTER_DAYS} days.`,
    async compute(c) {
      const { rows } = await db.execute(sql`
        select count(*) as n from candidate_tracker ct
        join candidate_tracker_stage_log l on l.tracker_id = ct.id and l.exited_at is null
        join workflow_stage s on s.id = l.stage_id
        where ${trackerScope(c)} and ct.status = 'active' and s.is_final_success = false
          and l.entered_at < now() - make_interval(days => ${STUCK_AFTER_DAYS})`);
      return Number(rows[0].n);
    },
  },
  {
    key: 'unassigned_candidates', label: 'Unassigned candidates', unit: 'count', direction: 'lower_better', kind: 'snapshot', cumulative: false, userScope: false,
    description: 'Active candidates with no recruiter assigned.',
    async compute(c) {
      const { rows } = await db.execute(sql`select count(*) as n from candidate_tracker ct where ct.organisation_id = ${c.orgId} and ct.team_id = ${c.teamId} and ct.status = 'active' and ct.assigned_hr is null`);
      return Number(rows[0].n);
    },
  },
  {
    key: 'open_vacancies', label: 'Open vacancies', unit: 'count', direction: 'lower_better', kind: 'snapshot', cumulative: false, userScope: false,
    description: 'Vacancies still to fill on open positions.',
    async compute(c) { const t = await positionTotals(c); return t.vacancies - t.filled; },
  },
  {
    key: 'fill_rate', label: 'Position fill rate', unit: '%', direction: 'higher_better', kind: 'snapshot', cumulative: false, userScope: false,
    description: 'Vacancies filled ÷ vacancies on open positions.',
    async compute(c) { const t = await positionTotals(c); return t.vacancies > 0 ? Math.round((t.filled / t.vacancies) * 100) : null; },
  },
];

const BY_KEY = new Map(METRICS.map((m) => [m.key, m]));

const getMetric = (key) => BY_KEY.get(key) || null;

/** What the API and the UI pickers see: everything but the compute function. */
const describe = (m) => ({
  key: m.key, label: m.label, unit: m.unit, direction: m.direction, kind: m.kind,
  cumulative: m.cumulative, userScope: m.userScope, description: m.description,
});
const listMetrics = () => METRICS.map(describe);

/**
 * Best-effort match of free text ("Placements per month", "Place 40 candidates")
 * to a catalogue key, used only when rolling existing hand-made KPIs / key
 * results onto the catalogue. Returns null when nothing matches confidently —
 * those stay manual rather than getting a wrong number.
 */
const GUESS = [
  [/days?\s+to\s+(place|fill|hire|join)|time[-\s]to[-\s](place|fill|hire|offer)/i, 'avg_days_to_place'],
  [/win\s*rate|conversion|success\s*rate/i, 'win_rate'],
  [/turn[-\s]?up\s*rate/i, 'turn_up_rate'],
  [/fill\s*rate/i, 'fill_rate'],
  [/stuck/i, 'stuck_candidates'],
  [/unassigned/i, 'unassigned_candidates'],
  [/vacanc/i, 'open_vacancies'],
  [/placements?|\bplace\b|\bplaced\b|\bjoined\b|\bjoiners?\b|\bhires?\b|\bhired\b/i, 'placements'],
  [/interviews?/i, 'interviews'],
  [/offers?/i, 'offers'],
  [/turn[-\s]?ups?/i, 'turn_ups'],
  [/line[-\s]?ups?/i, 'lineups'],
  [/screen(ing|ed|s)?\b/i, 'screenings'],
  [/\bcalls?\b/i, 'calls_made'],
  [/(candidates?|profiles?|resumes?|cvs?)\s+(added|sourced)|sourcing|sourced/i, 'candidates_added'],
];
function guessMetricKey(text) {
  const t = String(text || '');
  for (const [re, key] of GUESS) if (re.test(t)) return key;
  return null;
}

module.exports = { METRICS, getMetric, listMetrics, guessMetricKey, STUCK_AFTER_DAYS };
