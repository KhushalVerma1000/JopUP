const { db } = require('../../utils/db');
const { sql } = require('drizzle-orm');

const DEFAULT_DAYS = 90;
const DEFAULT_STUCK_DAYS = 5;

const int = (v) => Number(v || 0);
const round1 = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : null);

/**
 * Pipeline analytics, computed in SQL so the browser never has to download
 * every tracker just to count them. Each section is one aggregate query over
 * the same scoped set of candidate_tracker rows, run in parallel.
 *
 * Scope:  org (always) ∩ the caller's teams ∩ optional teamId.
 * Period: trackers created within the look-back window. "Positions to fill" is
 *         the exception — vacancies are a current-state question, not a period one.
 *
 * Funnel semantics: "reached" counts distinct candidates with a stage-log row
 * for that stage — the log is append-only, so it includes people who were
 * later rejected or placed. That's a true cohort funnel, not "currently at or
 * beyond". Stages are grouped by stage_key so teams with different workflow
 * templates roll up together.
 */
class AnalyticsService {
  async getPipeline(orgId, { teamIds, teamId, days, stuckAfterDays } = {}) {
    const window = days === 'all' ? null : Number(days || DEFAULT_DAYS);
    const stuckDays = Number(stuckAfterDays || DEFAULT_STUCK_DAYS);
    const cutoff = window ? new Date(Date.now() - window * 86_400_000).toISOString() : null;

    // Team reach: [] means "no teams", which must match nothing rather than everything.
    const teamCond = (col) => {
      const parts = [];
      if (teamIds !== null && teamIds !== undefined) parts.push(teamIds.length ? sql`${col} in (${sql.join(teamIds.map((t) => sql`${t}`), sql`, `)})` : sql`false`);
      if (teamId) parts.push(sql`${col} = ${teamId}`);
      return parts.length ? sql.join(parts, sql` and `) : sql`true`;
    };
    const where = sql`ct.organisation_id = ${orgId} and ${teamCond(sql`ct.team_id`)} and ${cutoff ? sql`ct.created_at >= ${cutoff}::timestamptz` : sql`true`}`;

    const [summary, current, funnel, toPlace, recruiters, positionTotals, positions, clients] = await Promise.all([
      db.execute(sql`
        select count(*) as total,
          count(*) filter (where ct.status = 'active') as active,
          count(*) filter (where ct.status = 'on_hold') as on_hold,
          count(*) filter (where ct.status = 'placed') as placed,
          count(*) filter (where ct.status = 'rejected') as rejected,
          count(*) filter (where ct.status = 'withdrawn') as withdrawn,
          count(*) filter (where ct.status = 'active' and ct.assigned_hr is null) as unassigned_active
        from candidate_tracker ct where ${where}`),

      db.execute(sql`
        select count(*) filter (where l.entered_at < now() - make_interval(days => ${stuckDays})) as stuck,
               avg(extract(epoch from (now() - l.entered_at)) / 86400) as avg_days
        from candidate_tracker ct
        join candidate_tracker_stage_log l on l.tracker_id = ct.id and l.exited_at is null
        join workflow_stage s on s.id = l.stage_id
        where ${where} and ct.status = 'active' and s.is_final_success = false`),

      db.execute(sql`
        select s.stage_key, min(s.name) as name, min(s.order_index) as order_index,
               bool_or(s.is_final_success) as is_final,
               count(distinct l.tracker_id) as reached,
               avg(extract(epoch from (coalesce(l.exited_at, now()) - l.entered_at)) / 86400) as avg_days
        from candidate_tracker ct
        join candidate_tracker_stage_log l on l.tracker_id = ct.id
        join workflow_stage s on s.id = l.stage_id
        where ${where}
        group by s.stage_key
        order by min(s.order_index), s.stage_key`),

      db.execute(sql`
        select avg(extract(epoch from (l.entered_at - ct.created_at)) / 86400) as days
        from candidate_tracker ct
        join candidate_tracker_stage_log l on l.tracker_id = ct.id
        join workflow_stage s on s.id = l.stage_id and s.is_final_success = true
        where ${where} and ct.status = 'placed'`),

      db.execute(sql`
        select u.id, u.first_name, u.last_name,
          count(*) as total,
          count(*) filter (where ct.status = 'active') as active,
          count(*) filter (where ct.status = 'on_hold') as on_hold,
          count(*) filter (where ct.status = 'placed') as placed,
          count(*) filter (where ct.status = 'rejected') as rejected
        from candidate_tracker ct
        join "user" u on u.id = ct.assigned_hr
        where ${where}
        group by u.id, u.first_name, u.last_name
        order by count(*) filter (where ct.status = 'placed') desc, count(*) filter (where ct.status = 'active') desc, u.first_name`),

      db.execute(sql`
        select count(*) as open_count,
               coalesce(sum(op.vacancies), 0) as vacancies,
               coalesce(sum(least(coalesce(p.placed, 0), op.vacancies)), 0) as filled
        from open_position op
        left join lateral (select count(*) as placed from candidate_tracker x where x.open_position_id = op.id and x.status = 'placed') p on true
        where op.organisation_id = ${orgId} and op.status = 'open' and ${teamCond(sql`op.team_id`)}`),

      db.execute(sql`
        select op.id, op.designation, op.team_id, op.vacancies, op.created_at, c.company_name,
               coalesce(p.placed, 0) as placed, coalesce(p.live, 0) as live
        from open_position op
        left join client c on c.id = op.client_id
        left join lateral (
          select count(*) filter (where x.status = 'placed') as placed,
                 count(*) filter (where x.status in ('active', 'on_hold')) as live
          from candidate_tracker x where x.open_position_id = op.id) p on true
        where op.organisation_id = ${orgId} and op.status = 'open' and ${teamCond(sql`op.team_id`)}
          and op.vacancies > coalesce(p.placed, 0)
        order by (op.vacancies - coalesce(p.placed, 0)) desc, op.created_at asc
        limit 10`),

      db.execute(sql`
        select c.id, c.company_name,
               count(*) filter (where ct.status = 'placed') as placed,
               count(*) filter (where ct.status in ('active', 'on_hold')) as live
        from candidate_tracker ct
        join open_position op on op.id = ct.open_position_id
        join client c on c.id = op.client_id
        where ${where}
        group by c.id, c.company_name
        having count(*) filter (where ct.status in ('placed', 'active', 'on_hold')) > 0
        order by count(*) filter (where ct.status = 'placed') desc, count(*) filter (where ct.status in ('active', 'on_hold')) desc
        limit 10`),
    ]);

    const s = summary.rows[0];
    const closed = int(s.placed) + int(s.rejected);
    const cur = current.rows[0];

    let previous = null;
    const funnelRows = funnel.rows.map((r) => {
      const reached = int(r.reached);
      const row = {
        stageKey: r.stage_key, name: r.name, orderIndex: int(r.order_index), isFinal: !!r.is_final, reached,
        conversionFromPrevious: previous === null ? null : Math.min(100, pct(reached, previous) ?? 0),
        // A final stage has no "time in stage": people stay there forever.
        avgDaysInStage: r.is_final ? null : round1(r.avg_days),
      };
      previous = reached;
      return row;
    });

    const pt = positionTotals.rows[0];
    const vacancies = int(pt.vacancies);
    const filled = int(pt.filled);

    return {
      period: { days: window, since: cutoff },
      stuckAfterDays: stuckDays,
      summary: {
        total: int(s.total), active: int(s.active), onHold: int(s.on_hold), placed: int(s.placed), rejected: int(s.rejected), withdrawn: int(s.withdrawn),
        closed, winRatePct: pct(int(s.placed), closed),
        unassignedActive: int(s.unassigned_active),
        stuck: int(cur.stuck), avgDaysInCurrentStage: round1(cur.avg_days),
        avgDaysToPlace: round1(toPlace.rows[0]?.days),
      },
      funnel: funnelRows,
      recruiters: recruiters.rows.map((r) => ({
        userId: r.id, name: [r.first_name, r.last_name].filter(Boolean).join(' '),
        total: int(r.total), active: int(r.active), onHold: int(r.on_hold), placed: int(r.placed), rejected: int(r.rejected),
        winRatePct: pct(int(r.placed), int(r.placed) + int(r.rejected)),
      })),
      positions: {
        openCount: int(pt.open_count), vacancies, filled, fillRatePct: pct(filled, vacancies),
        needingAttention: positions.rows.map((p) => ({
          id: p.id, designation: p.designation, teamId: p.team_id, clientName: p.company_name || null,
          vacancies: int(p.vacancies), filled: int(p.placed), remaining: int(p.vacancies) - int(p.placed),
          liveCandidates: int(p.live), ageDays: Math.floor((Date.now() - new Date(p.created_at).getTime()) / 86_400_000),
        })),
      },
      clients: clients.rows.map((c) => ({ clientId: c.id, name: c.company_name, placed: int(c.placed), live: int(c.live) })),
    };
  }
}

module.exports = new AnalyticsService();
