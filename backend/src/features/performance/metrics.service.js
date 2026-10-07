const { db, schema } = require('../../utils/db');
const { eq, and, inArray, sql } = require('drizzle-orm');
const { getMetric, listMetrics } = require('./metrics.catalogue');
const { startOfLocalDay, addDays, localDate } = require('../../utils/zonedTime');
const math = require('./performance.math');

const BACKFILL_PERIODS = 8;     // history built the first time an auto KPI is synced
const FRESH_MS = 15 * 60_000;   // a reading younger than this is served as is

const kpiActive = (row) => row.isActive !== 'false' && row.isActive !== false;
const inList = (col, ids) => inArray(col, ids);

/**
 * Computes catalogue metrics and writes them where they are used:
 *   KPIs        — one auto reading per period, locked once the period has closed
 *   Goals       — progress from the pipeline over [start_date, due_date], frozen after the window
 *   Strategies  — key results resolved live; frozen into the strategy when its period ends
 *
 * Everything here is idempotent, so the hourly job, a lazy refresh on read and a
 * manager pressing "Recompute" can all run it without stepping on each other.
 */
class MetricsService {
  catalogue() { return listMetrics(); }

  async orgTz(orgId) {
    const [o] = await db.select({ tz: schema.organisation.timezone }).from(schema.organisation).where(eq(schema.organisation.id, orgId)).limit(1);
    return o?.tz || 'UTC';
  }

  /**
   * Value of one metric for a team (optionally one person) over the local-date
   * window [startYmd, endYmd] (inclusive). null = nothing to measure (e.g. a win
   * rate with no closed candidates), which is different from zero.
   */
  async compute(orgId, key, { teamId, userId = null, startYmd, endYmd, tz }, memo) {
    const metric = getMetric(key);
    if (!metric) throw new Error(`Unknown metric '${key}'`);
    if (userId && !metric.userScope) throw new Error(`Metric '${key}' is measured for a whole team only`);

    const memoKey = memo ? [orgId, key, teamId, userId || '', startYmd, endYmd, tz].join('|') : null;
    if (memo?.has(memoKey)) return memo.get(memoKey);

    const from = startOfLocalDay(startYmd, tz).toISOString();
    const to = startOfLocalDay(addDays(endYmd, 1), tz).toISOString();
    const value = await metric.compute({ orgId, teamId, userId, from, to });
    const out = value === null || value === undefined ? null : Number(value);
    if (memo) memo.set(memoKey, out);
    return out;
  }

  // ── KPIs ──────────────────────────────────────────────────────────────────
  /**
   * Bring one auto KPI's readings up to date. Walks the most recent periods,
   * oldest first, and for each: leaves locked and person-written readings alone,
   * computes the rest, and locks a period the moment it has closed.
   * `recent` limits how far back to look (the hourly job only needs the last two).
   */
  async syncKpi(kpi, { now = new Date(), tz, recent = BACKFILL_PERIODS, force = false } = {}) {
    if (kpi.source !== 'auto' || !kpi.metricKey || !kpiActive(kpi)) return { written: 0 };
    const metric = getMetric(kpi.metricKey);
    if (!metric) return { written: 0 };

    const zone = tz || await this.orgTz(kpi.organisationId);
    const today = localDate(now, zone);
    // A snapshot can't be rebuilt for the past: only the open period (and the one just closed, to lock it).
    let periods = math.recentPeriods(kpi.frequency, today, metric.kind === 'snapshot' ? Math.min(2, recent) : recent);

    // Don't invent a run of zeros for months before the team had any pipeline at all.
    if (periods.length > 1) {
      const { rows } = await db.execute(sql`select min(created_at) as first from candidate_tracker where organisation_id = ${kpi.organisationId} and team_id = ${kpi.teamId}`);
      const first = rows[0].first ? localDate(new Date(rows[0].first), zone) : null;
      periods = periods.filter((p, i) => i === periods.length - 1 || (first !== null && p.end > first));
    }

    let written = 0;
    for (const p of periods) {
      const closed = p.end <= today;
      const [existing] = await db.select().from(schema.kpiEntry)
        .where(and(eq(schema.kpiEntry.kpiId, kpi.id), eq(schema.kpiEntry.periodDate, p.start))).limit(1);

      if (existing && (existing.lockedAt || existing.source !== 'auto')) continue;
      if (!force && existing && !closed && existing.computedAt && now.getTime() - new Date(existing.computedAt).getTime() < FRESH_MS) continue;

      if (metric.kind === 'snapshot' && closed) {
        if (existing) { await db.update(schema.kpiEntry).set({ lockedAt: now }).where(eq(schema.kpiEntry.id, existing.id)); written++; }
        continue;
      }

      const value = await this.compute(kpi.organisationId, kpi.metricKey, { teamId: kpi.teamId, startYmd: p.start, endYmd: addDays(p.end, -1), tz: zone });
      if (value === null) continue;

      const label = math.defaultPeriodLabel(kpi.frequency, p.start);
      await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`kpi_entry:${kpi.id}:${p.start}`}))`);
        const [cur] = await tx.select().from(schema.kpiEntry)
          .where(and(eq(schema.kpiEntry.kpiId, kpi.id), eq(schema.kpiEntry.periodDate, p.start))).limit(1);
        if (cur && (cur.lockedAt || cur.source !== 'auto')) return;   // someone got there first
        const patch = { value, computedValue: value, source: 'auto', periodLabel: label, computedAt: now, lockedAt: closed ? now : null };
        if (cur) await tx.update(schema.kpiEntry).set(patch).where(eq(schema.kpiEntry.id, cur.id));
        else await tx.insert(schema.kpiEntry).values({ ...patch, kpiId: kpi.id, teamId: kpi.teamId, recordedBy: null, periodDate: p.start });
        written++;
      });
    }
    return { written };
  }

  /** The value the system would record for this KPI's period right now (used for overrides and reverts). */
  async computeKpiPeriod(kpi, periodDate, now = new Date()) {
    const metric = getMetric(kpi.metricKey);
    if (!metric) return null;
    const tz = await this.orgTz(kpi.organisationId);
    const p = math.periodBounds(kpi.frequency, periodDate);
    if (metric.kind === 'snapshot' && p.end <= localDate(now, tz)) return null;   // history of a snapshot is gone
    return this.compute(kpi.organisationId, kpi.metricKey, { teamId: kpi.teamId, startYmd: p.start, endYmd: addDays(p.end, -1), tz });
  }

  // ── Goals ─────────────────────────────────────────────────────────────────
  /** Recompute one metric goal. Returns the updated row (or the row unchanged if nothing to do). */
  async syncGoal(goal, { now = new Date(), tz, memo } = {}) {
    if (goal.progressSource !== 'auto' || !goal.metricKey || goal.finalizedAt) return goal;
    if (goal.status === 'cancelled') return goal;
    const metric = getMetric(goal.metricKey);
    if (!metric) return goal;

    const zone = tz || await this.orgTz(goal.organisationId);
    const today = localDate(now, zone);
    const start = goal.startDate || String(goal.createdAt instanceof Date ? goal.createdAt.toISOString() : goal.createdAt).slice(0, 10);
    const end = goal.dueDate && goal.dueDate < today ? goal.dueDate : today;
    const windowClosed = !!goal.dueDate && goal.dueDate < today;

    // Metric goals measure from start to the earlier of today / the due date.
    const value = start > end ? null : await this.compute(goal.organisationId, goal.metricKey,
      { teamId: goal.teamId, userId: goal.assignedTo || null, startYmd: start, endYmd: end, tz: zone }, memo);
    const progress = value === null ? 0 : (math.progressPct(value, goal.targetValue, metric.direction) ?? 0);

    const patch = { currentValue: value, progressPct: progress, syncedAt: now };
    const reached = progress >= 100;
    if (reached && (metric.cumulative || windowClosed) && goal.status !== 'completed') { patch.status = 'completed'; patch.completedAt = now; }
    if (windowClosed || (reached && metric.cumulative)) patch.finalizedAt = now;   // nothing more can change the answer

    const [updated] = await db.update(schema.goal).set(patch).where(eq(schema.goal.id, goal.id)).returning();
    return updated;
  }

  async syncGoalsForOrg(orgId, { now = new Date(), tz, teamIds = null, force = false } = {}) {
    const conds = [eq(schema.goal.organisationId, orgId), eq(schema.goal.progressSource, 'auto'), sql`${schema.goal.finalizedAt} is null`, sql`${schema.goal.status} <> 'cancelled'`];
    if (teamIds) conds.push(teamIds.length ? inList(schema.goal.teamId, teamIds) : sql`false`);
    if (!force) conds.push(sql`(${schema.goal.syncedAt} is null or ${schema.goal.syncedAt} < ${new Date(now.getTime() - FRESH_MS).toISOString()}::timestamptz)`);
    const goals = await db.select().from(schema.goal).where(and(...conds));
    const zone = tz || await this.orgTz(orgId);
    const memo = new Map();
    for (const g of goals) await this.syncGoal(g, { now, tz: zone, memo });
    return goals.length;
  }

  // ── Strategy ──────────────────────────────────────────────────────────────
  /**
   * Turn a strategy's stored objectives into what the UI shows: every key result
   * gets its current value, progress and on-track status. Metric / KPI / goal
   * key results are measured live over the strategy window; manual ones use the
   * number a person typed. A finalized strategy returns its frozen values.
   */
  async resolveStrategy(strategy, { now = new Date(), tz } = {}) {
    const zone = tz || await this.orgTz(strategy.organisationId);
    const today = localDate(now, zone);
    const window = strategy.periodStart && strategy.periodEnd ? { start: strategy.periodStart, end: strategy.periodEnd } : null;
    const frozen = !!strategy.finalizedAt;
    const memo = new Map();

    const kpiIds = new Set(); const goalIds = new Set();
    for (const o of strategy.objectives || []) for (const k of o.key_results || []) {
      if (k.type === 'kpi' && k.kpi_id) kpiIds.add(k.kpi_id);
      if (k.type === 'goal') (k.goal_ids || []).forEach((g) => goalIds.add(g));
    }
    const [kpiRows, goalRows] = await Promise.all([
      kpiIds.size ? db.select().from(schema.kpiDefinition).where(and(eq(schema.kpiDefinition.organisationId, strategy.organisationId), inList(schema.kpiDefinition.id, [...kpiIds]))) : [],
      goalIds.size ? db.select().from(schema.goal).where(and(eq(schema.goal.organisationId, strategy.organisationId), inList(schema.goal.id, [...goalIds]))) : [],
    ]);
    const kpiById = new Map(kpiRows.map((k) => [k.id, k]));
    const goalById = new Map(goalRows.map((g) => [g.id, g]));

    const latestKpi = async (kpiId) => {
      const conds = [eq(schema.kpiEntry.kpiId, kpiId)];
      if (window) conds.push(sql`${schema.kpiEntry.periodDate} <= ${window.end}`);
      const [row] = await db.select().from(schema.kpiEntry).where(and(...conds))
        .orderBy(sql`${schema.kpiEntry.periodDate} desc`, sql`${schema.kpiEntry.createdAt} desc`).limit(1);
      return row ? row.value : null;
    };

    const resolveKr = async (k) => {
      const type = k.type || 'manual';
      const base = { ...k, type, source: type === 'manual' ? 'manual' : 'auto' };
      let current = k.current ?? null; let direction = 'higher_better'; let unit = null; let pacing = false; let label = null; let note = null;

      if (type === 'metric') {
        const m = getMetric(k.metric_key);
        if (!m) return { ...base, current: null, progressPct: null, status: 'no_data', note: 'Unknown metric' };
        direction = m.direction; unit = m.unit; pacing = m.cumulative; label = m.label;
        if (!frozen) {
          if (!window) note = 'Add start and end dates to measure this';
          else current = await this.compute(strategy.organisationId, k.metric_key, { teamId: strategy.teamId, startYmd: window.start, endYmd: window.end < today ? window.end : today, tz: zone }, memo);
        }
      } else if (type === 'kpi') {
        const kpi = kpiById.get(k.kpi_id);
        if (!kpi) return { ...base, current: null, progressPct: null, status: 'no_data', note: 'That KPI no longer exists' };
        direction = kpi.direction; unit = kpi.unit; label = kpi.name;
        if (!frozen) current = await latestKpi(kpi.id);
      } else if (type === 'goal') {
        const goals = (k.goal_ids || []).map((id) => goalById.get(id)).filter(Boolean);
        label = goals.length ? `${goals.length} goal${goals.length === 1 ? '' : 's'}` : 'Linked goals'; unit = '%';
        if (!frozen) current = goals.length ? math.mean(goals.map((g) => g.progressPct)) : null;
        const target = 100;
        const progress = current === null ? null : math.progressPct(current, target);
        return { ...base, target, current, unit, label, direction, progressPct: progress, status: math.krStatus({ progress, current, target, direction, pacing: true }, window, today) };
      }

      const progress = math.progressPct(current, k.target, direction);
      return { ...base, current, unit, label, direction, note, progressPct: progress, status: math.krStatus({ progress, current, target: k.target, direction, pacing }, window, today) };
    };

    const objectives = [];
    for (const o of strategy.objectives || []) {
      const key_results = [];
      for (const k of o.key_results || []) key_results.push(await resolveKr(k));
      objectives.push({ ...o, key_results, progressPct: math.mean(key_results.map((k) => k.progressPct)) });
    }
    return { objectives, progressPct: math.mean(objectives.map((o) => o.progressPct)), window };
  }

  /** Freeze a finished strategy: write the final value of every auto key result into it. */
  async finalizeStrategy(strategy, { now = new Date(), tz } = {}) {
    if (strategy.finalizedAt || !strategy.periodEnd) return strategy;
    const zone = tz || await this.orgTz(strategy.organisationId);
    if (strategy.periodEnd >= localDate(now, zone)) return strategy;   // period still running
    const resolved = await this.resolveStrategy(strategy, { now, tz: zone });
    const objectives = (strategy.objectives || []).map((o, oi) => ({
      ...o,
      key_results: (o.key_results || []).map((k, ki) => ({ ...k, current: resolved.objectives[oi].key_results[ki].current })),
    }));
    const [updated] = await db.update(schema.teamStrategy).set({ objectives, finalizedAt: now, updatedAt: now })
      .where(eq(schema.teamStrategy.id, strategy.id)).returning();
    return updated;
  }

  // ── Orchestration ─────────────────────────────────────────────────────────
  /** Sync everything automatic in one org. `teamIds` limits it to teams the caller may manage. */
  async syncOrg(orgId, { now = new Date(), teamIds = null, force = false } = {}) {
    const tz = await this.orgTz(orgId);
    const kpiConds = [eq(schema.kpiDefinition.organisationId, orgId), eq(schema.kpiDefinition.source, 'auto')];
    if (teamIds) kpiConds.push(teamIds.length ? inList(schema.kpiDefinition.teamId, teamIds) : sql`false`);
    const kpis = await db.select().from(schema.kpiDefinition).where(and(...kpiConds));

    let kpiWrites = 0;
    for (const k of kpis) kpiWrites += (await this.syncKpi(k, { now, tz, force, recent: force ? BACKFILL_PERIODS : 2 })).written;
    const goals = await this.syncGoalsForOrg(orgId, { now, tz, teamIds, force });

    const stratConds = [eq(schema.teamStrategy.organisationId, orgId), sql`${schema.teamStrategy.finalizedAt} is null`, sql`${schema.teamStrategy.periodEnd} is not null`];
    if (teamIds) stratConds.push(teamIds.length ? inList(schema.teamStrategy.teamId, teamIds) : sql`false`);
    const open = await db.select().from(schema.teamStrategy).where(and(...stratConds));
    let finalized = 0;
    for (const s of open) { const r = await this.finalizeStrategy(s, { now, tz }); if (r.finalizedAt) finalized++; }

    return { kpis: kpis.length, kpiWrites, goals, strategiesFinalized: finalized };
  }

  /** Every org that has anything automatic. Used by the hourly job. */
  async syncAll(now = new Date()) {
    const { rows } = await db.execute(sql`
      select distinct organisation_id as id from kpi_definition where source = 'auto'
      union select distinct organisation_id from goal where progress_source = 'auto' and finalized_at is null
      union select distinct organisation_id from team_strategy where finalized_at is null and period_end is not null`);
    const out = [];
    for (const r of rows) {
      try { out.push({ orgId: r.id, ...(await this.syncOrg(r.id, { now })) }); }
      catch (err) { console.error(`[performance-sync] org ${r.id}: ${err.message}`); }
    }
    return out;
  }
}

module.exports = new MetricsService();
module.exports.FRESH_MS = FRESH_MS;
