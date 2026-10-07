const { db, schema } = require('../../utils/db');
const { eq, and, or, ne, inArray, asc, desc, sql } = require('drizzle-orm');
const { NotFoundError, BadRequestError, ConflictError } = require('../../utils/errors');
const { auditWrite } = require('../../utils/audit');
const { visibleTeamIds, teamsWithPermission } = require('../../utils/teamScope');
const math = require('./performance.math');
const metrics = require('./metrics.service');
const { getMetric } = require('./metrics.catalogue');
const { localDate } = require('../../utils/zonedTime');

const fullName = (u) => (u ? [u.firstName, u.lastName].filter(Boolean).join(' ') : null);
// kpi_definition.is_active is a text column ('true'/'false'); the API speaks booleans.
const kpiActive = (row) => row.isActive !== 'false' && row.isActive !== false;

/** SQL condition limiting `col` to a set of team ids (null = unrestricted, [] = nothing). */
function inTeams(col, ids) {
  if (ids === null) return undefined;
  return ids.length ? inArray(col, ids) : sql`false`;
}

class PerformanceService {
  // ── shared lookups ────────────────────────────────────────────────────────
  async _userNames(ids) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const rows = await db.select({ id: schema.user.id, firstName: schema.user.firstName, lastName: schema.user.lastName })
      .from(schema.user).where(inArray(schema.user.id, unique));
    return new Map(rows.map((u) => [u.id, fullName(u)]));
  }

  async _teamNames(orgId) {
    const rows = await db.select({ id: schema.team.id, name: schema.team.name }).from(schema.team).where(eq(schema.team.organisationId, orgId));
    return new Map(rows.map((t) => [t.id, t.name]));
  }

  /** Is `userId` an active member of `teamId` (same org)? */
  async _assertTeamMember(orgId, teamId, userId, what = 'That person') {
    const [row] = await db.select({ id: schema.user.id })
      .from(schema.userTeamRole)
      .innerJoin(schema.user, eq(schema.user.id, schema.userTeamRole.userId))
      .where(and(
        eq(schema.userTeamRole.teamId, teamId), eq(schema.userTeamRole.userId, userId),
        sql`${schema.userTeamRole.revokedAt} is null`,
        eq(schema.user.organisationId, orgId), eq(schema.user.status, 'active'),
      )).limit(1);
    if (!row) throw new BadRequestError(`${what} isn't an active member of that team`);
  }

  async _assertTeamInOrg(orgId, teamId) {
    const [t] = await db.select({ id: schema.team.id }).from(schema.team)
      .where(and(eq(schema.team.id, teamId), eq(schema.team.organisationId, orgId))).limit(1);
    if (!t) throw new NotFoundError('Team not found');
  }

  /**
   * Load a row by id inside the caller's org and teams. Anything outside —
   * another tenant's id, or a team the caller can't see — is a plain 404, so
   * ids can't be probed. `mode` picks whether read or write reach is required.
   */
  async _load(table, orgId, user, id, label, { entity, action }) {
    const [row] = await db.select().from(table).where(and(eq(table.id, id), eq(table.organisationId, orgId))).limit(1);
    const reach = action === 'read' ? visibleTeamIds(user) : teamsWithPermission(user, entity, action);
    if (!row || (reach !== null && !reach.includes(row.teamId))) throw new NotFoundError(`${label} not found`);
    return row;
  }

  // ── KPIs ──────────────────────────────────────────────────────────────────
  /**
   * One round trip for a whole KPI board: definitions + each KPI's latest
   * reading and recent trend (window function, no N+1) + server-computed
   * health, so every client colours a KPI the same way.
   */
  async listKpis(orgId, user, { teamId, includeInactive } = {}) {
    const conds = [eq(schema.kpiDefinition.organisationId, orgId)];
    const reach = inTeams(schema.kpiDefinition.teamId, visibleTeamIds(user));
    if (reach) conds.push(reach);
    if (teamId) conds.push(eq(schema.kpiDefinition.teamId, teamId));
    if (includeInactive !== 'true') conds.push(sql`${schema.kpiDefinition.isActive} is distinct from 'false'`);

    let defs = await db.select().from(schema.kpiDefinition).where(and(...conds)).orderBy(asc(schema.kpiDefinition.name));
    if (!defs.length) return [];

    // Automatic KPIs refresh themselves when read, so a board is never older than a few minutes
    // even between runs of the hourly job. Locked and recent readings are skipped inside syncKpi.
    const autos = defs.filter((d) => d.source === 'auto' && kpiActive(d));
    if (autos.length) {
      const tz = await metrics.orgTz(orgId);
      await Promise.all(autos.map((d) => metrics.syncKpi(d, { tz, recent: 2 }).catch((e) => console.error(`[kpi-sync] ${d.id}: ${e.message}`))));
    }

    const ids = defs.map((d) => d.id);
    const [{ rows }, teamNames] = await Promise.all([
      db.execute(sql`
        select id, kpi_id, value, period_label, period_date::text as period_date, source, computed_value, override_reason, locked_at
        from (
          select id, kpi_id, value, period_label, period_date, created_at, source, computed_value, override_reason, locked_at,
                 row_number() over (partition by kpi_id order by period_date desc, created_at desc) as rn
          from kpi_entry where kpi_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
        ) t
        where rn <= ${math.RECENT_POINTS}
        order by kpi_id, period_date asc, created_at asc`),
      this._teamNames(orgId),
    ]);

    const byKpi = new Map();
    for (const r of rows) {
      if (!byKpi.has(r.kpi_id)) byKpi.set(r.kpi_id, []);
      byKpi.get(r.kpi_id).push({
        id: r.id, value: Number(r.value), periodLabel: r.period_label, periodDate: r.period_date,
        source: r.source, locked: !!r.locked_at, overridden: r.source === 'override',
        computedValue: r.computed_value === null ? null : Number(r.computed_value), overrideReason: r.override_reason || null,
      });
    }

    return defs.map((d) => {
      const recent = byKpi.get(d.id) || [];
      const latest = recent[recent.length - 1] || null;
      const previous = recent.length > 1 ? recent[recent.length - 2] : null;
      const delta = math.changePct(previous?.value, latest?.value);
      return {
        ...d,
        isActive: kpiActive(d),
        isAuto: d.source === 'auto',
        metric: d.metricKey ? (({ key, label, kind, cumulative }) => ({ key, label, kind, cumulative }))(getMetric(d.metricKey) || {}) : null,
        teamName: teamNames.get(d.teamId) || null,
        latest, recent,
        health: math.kpiHealth(latest ? latest.value : null, d.targetValue, d.direction),
        changePct: delta,
        improving: math.isImprovement(delta, d.direction),
      };
    });
  }

  async createKpiDefinition(orgId, data, userId) {
    await this._assertTeamInOrg(orgId, data.teamId);
    const values = { ...data, organisationId: orgId, createdBy: userId };
    if (data.metricKey) {
      // Automatic: the metric supplies whatever the manager left out.
      const m = getMetric(data.metricKey);
      Object.assign(values, {
        source: 'auto', name: data.name || m.label, unit: data.unit ?? m.unit, direction: data.direction || m.direction,
        description: data.description ?? m.description,
        frequency: data.frequency || (m.kind === 'snapshot' ? 'weekly' : 'monthly'),
      });
    } else values.source = 'manual';
    const [kpi] = await db.insert(schema.kpiDefinition).values(values).returning();
    await auditWrite(orgId, userId, 'create', 'kpi', kpi.id, null, kpi, 'performance');
    // Build its history straight away so the board isn't empty until the next hourly run.
    if (kpi.source === 'auto') await metrics.syncKpi(kpi, { recent: 8 }).catch((e) => console.error(`[kpi-sync] ${kpi.id}: ${e.message}`));
    return { ...kpi, isActive: kpiActive(kpi), isAuto: kpi.source === 'auto' };
  }

  async updateKpiDefinition(orgId, user, id, data) {
    const old = await this._load(schema.kpiDefinition, orgId, user, id, 'KPI', { entity: 'kpi', action: 'write' });
    const { isActive, ...rest } = data;
    if (old.source === 'auto' && rest.frequency && rest.frequency !== old.frequency) {
      throw new ConflictError('An automatic KPI keeps its frequency, because its history is built period by period. Create a new KPI for a different frequency');
    }
    const patch = { ...rest, updatedAt: new Date() };
    if (isActive !== undefined) patch.isActive = isActive ? 'true' : 'false';
    const [updated] = await db.update(schema.kpiDefinition).set(patch)
      .where(and(eq(schema.kpiDefinition.id, id), eq(schema.kpiDefinition.organisationId, orgId))).returning();
    await auditWrite(orgId, user.userId, 'update', 'kpi', id, old, updated, 'performance');
    return { ...updated, isActive: kpiActive(updated) };
  }

  async getKpiEntries(orgId, user, kpiId, { limit } = {}) {
    await this._load(schema.kpiDefinition, orgId, user, kpiId, 'KPI', { entity: 'kpi', action: 'read' });
    const rows = await db.select().from(schema.kpiEntry).where(eq(schema.kpiEntry.kpiId, kpiId))
      .orderBy(desc(schema.kpiEntry.periodDate), desc(schema.kpiEntry.createdAt)).limit(limit || 200);
    return rows.reverse(); // oldest → newest, ready to plot
  }

  /**
   * Record a reading. One reading per KPI per period date: recording the same
   * period again corrects it instead of stacking a duplicate. The advisory
   * lock makes that check-then-write safe against a double-tap.
   */
  async recordKpiEntry(orgId, user, data) {
    const kpi = await this._load(schema.kpiDefinition, orgId, user, data.kpiId, 'KPI', { entity: 'kpi', action: 'write' });
    if (data.teamId && data.teamId !== kpi.teamId) throw new BadRequestError('That KPI belongs to a different team');
    if (!kpiActive(kpi)) throw new ConflictError('This KPI is switched off. Turn it back on to record values');

    const periodDate = math.periodBounds(kpi.frequency, data.periodDate || localDate(new Date(), await metrics.orgTz(orgId))).start;
    const periodLabel = data.periodLabel || math.defaultPeriodLabel(kpi.frequency, periodDate);

    if (kpi.source === 'auto') return this._overrideKpiEntry(orgId, user, kpi, { ...data, periodDate, periodLabel });

    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`kpi_entry:${kpi.id}:${periodDate}`}))`);
      const [existing] = await tx.select().from(schema.kpiEntry)
        .where(and(eq(schema.kpiEntry.kpiId, kpi.id), eq(schema.kpiEntry.periodDate, periodDate))).limit(1);
      if (existing) {
        const [entry] = await tx.update(schema.kpiEntry)
          .set({ value: data.value, periodLabel, notes: data.notes ?? existing.notes, recordedBy: user.userId })
          .where(eq(schema.kpiEntry.id, existing.id)).returning();
        return { entry, replaced: true };
      }
      const [entry] = await tx.insert(schema.kpiEntry).values({
        kpiId: kpi.id, teamId: kpi.teamId, value: data.value, periodLabel, periodDate, notes: data.notes, recordedBy: user.userId,
      }).returning();
      return { entry, replaced: false };
    });
  }

  /**
   * An automatic KPI's reading can be corrected by a person, but never silently:
   * a reason is required, and the value the system computed is kept beside it.
   */
  async _overrideKpiEntry(orgId, user, kpi, data) {
    if (!data.notes) throw new BadRequestError('Add a reason to override a computed reading');
    const computed = await metrics.computeKpiPeriod(kpi, data.periodDate);
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`kpi_entry:${kpi.id}:${data.periodDate}`}))`);
      const [existing] = await tx.select().from(schema.kpiEntry)
        .where(and(eq(schema.kpiEntry.kpiId, kpi.id), eq(schema.kpiEntry.periodDate, data.periodDate))).limit(1);
      const patch = {
        value: data.value, source: 'override', overrideReason: data.notes, notes: data.notes, periodLabel: data.periodLabel, recordedBy: user.userId,
        computedValue: existing?.computedValue ?? computed,
      };
      if (existing) {
        const [entry] = await tx.update(schema.kpiEntry).set(patch).where(eq(schema.kpiEntry.id, existing.id)).returning();
        await auditWrite(orgId, user.userId, 'override', 'kpi_entry', entry.id, existing, entry, 'performance');
        return { entry, replaced: true };
      }
      const [entry] = await tx.insert(schema.kpiEntry).values({ ...patch, kpiId: kpi.id, teamId: kpi.teamId, periodDate: data.periodDate }).returning();
      await auditWrite(orgId, user.userId, 'override', 'kpi_entry', entry.id, null, entry, 'performance');
      return { entry, replaced: false };
    });
  }

  /** Drop an override: the reading goes back to what the system computes. */
  async revertKpiOverride(orgId, user, entryId) {
    const [entry] = await db.select().from(schema.kpiEntry).where(eq(schema.kpiEntry.id, entryId)).limit(1);
    if (!entry) throw new NotFoundError('Reading not found');
    const kpi = await this._load(schema.kpiDefinition, orgId, user, entry.kpiId, 'Reading', { entity: 'kpi', action: 'write' });
    if (entry.source !== 'override') throw new ConflictError('This reading has not been overridden');
    const value = (await metrics.computeKpiPeriod(kpi, entry.periodDate)) ?? entry.computedValue;
    if (value === null || value === undefined) throw new ConflictError('The computed value for that period is no longer available, so the override has to stay');
    const [updated] = await db.update(schema.kpiEntry)
      .set({ value, computedValue: value, source: 'auto', overrideReason: null, notes: null, recordedBy: null, computedAt: new Date() })
      .where(eq(schema.kpiEntry.id, entryId)).returning();
    await auditWrite(orgId, user.userId, 'revert_override', 'kpi_entry', entryId, entry, updated, 'performance');
    return updated;
  }

  /** "Recompute now" for one automatic KPI (open periods and any not yet locked). */
  async recomputeKpi(orgId, user, id) {
    const kpi = await this._load(schema.kpiDefinition, orgId, user, id, 'KPI', { entity: 'kpi', action: 'write' });
    if (kpi.source !== 'auto') throw new ConflictError('Only automatic KPIs can be recomputed');
    const { written } = await metrics.syncKpi(kpi, { recent: 8, force: true });
    return { written };
  }

  /** Recompute everything automatic in the teams the caller manages. */
  async syncNow(orgId, user) {
    const kpiTeams = teamsWithPermission(user, 'kpi', 'write');
    const goalTeams = teamsWithPermission(user, 'goals', 'write');
    const teamIds = kpiTeams === null || goalTeams === null ? null : [...new Set([...kpiTeams, ...goalTeams])];
    return metrics.syncOrg(orgId, { teamIds, force: true });
  }

  // ── Reviews ───────────────────────────────────────────────────────────────
  _shapeReview(r, user, names, teamNames, manageIds) {
    const canManage = manageIds === null || manageIds.includes(r.teamId);
    const out = {
      ...r,
      teamName: teamNames.get(r.teamId) || null,
      revieweeName: names.get(r.revieweeId) || null,
      reviewerName: names.get(r.reviewerId) || null,
      averageScore: math.averageScore(r.scores),
      isMine: r.revieweeId === user.userId,
      canEdit: canManage && r.status === 'draft',
      canAcknowledge: r.revieweeId === user.userId && r.status === 'submitted',
    };
    // The reviewer's private notes never leave the manager side.
    if (!canManage) delete out.managerNotes;
    return out;
  }

  /**
   * Managers (reviews:write) see every review for the teams they manage.
   * Everyone else sees only reviews about themselves, and only once submitted —
   * never drafts, never anyone else's, never the private notes.
   */
  async getReviews(orgId, user, { teamId, revieweeId, status } = {}) {
    const manageIds = teamsWithPermission(user, 'performance_reviews', 'write');
    const manageCond = manageIds === null ? sql`true` : manageIds.length ? inArray(schema.performanceReview.teamId, manageIds) : sql`false`;
    const mineCond = and(eq(schema.performanceReview.revieweeId, user.userId), ne(schema.performanceReview.status, 'draft'));

    const conds = [eq(schema.performanceReview.organisationId, orgId), or(manageCond, mineCond)];
    if (teamId) conds.push(eq(schema.performanceReview.teamId, teamId));
    if (revieweeId) conds.push(eq(schema.performanceReview.revieweeId, revieweeId));
    if (status) conds.push(eq(schema.performanceReview.status, status));

    const rows = await db.select().from(schema.performanceReview).where(and(...conds)).orderBy(desc(schema.performanceReview.createdAt));
    const [names, teamNames] = await Promise.all([this._userNames(rows.flatMap((r) => [r.revieweeId, r.reviewerId])), this._teamNames(orgId)]);
    return rows.map((r) => this._shapeReview(r, user, names, teamNames, manageIds));
  }

  async createReview(orgId, user, data) {
    await this._assertTeamInOrg(orgId, data.teamId);
    if (data.revieweeId === user.userId) throw new BadRequestError('You can\'t write a review of yourself');
    await this._assertTeamMember(orgId, data.teamId, data.revieweeId, 'The person you\'re reviewing');

    const [dupe] = await db.select({ id: schema.performanceReview.id }).from(schema.performanceReview).where(and(
      eq(schema.performanceReview.organisationId, orgId), eq(schema.performanceReview.teamId, data.teamId),
      eq(schema.performanceReview.revieweeId, data.revieweeId), sql`lower(${schema.performanceReview.cycle}) = lower(${data.cycle})`,
    )).limit(1);
    if (dupe) throw new ConflictError(`There's already a review for ${data.cycle}. Open it instead of starting another`);

    const [review] = await db.insert(schema.performanceReview).values({ ...data, organisationId: orgId, reviewerId: user.userId }).returning();
    await auditWrite(orgId, user.userId, 'create', 'review', review.id, null, review, 'performance');
    return this._one(orgId, user, review.id);
  }

  async updateReview(orgId, user, id, data) {
    const old = await this._load(schema.performanceReview, orgId, user, id, 'Review', { entity: 'performance_reviews', action: 'write' });
    if (old.status !== 'draft') throw new ConflictError('This review has been submitted and can no longer be edited');

    const next = { ...old, ...data };
    if (data.status === 'submitted' && !next.summary && !Object.keys(next.scores || {}).length) {
      throw new BadRequestError('Add at least one score or a summary before submitting');
    }
    const patch = { ...data, updatedAt: new Date() };
    if (data.status === 'submitted') patch.submittedAt = new Date();

    const [updated] = await db.update(schema.performanceReview).set(patch)
      .where(and(eq(schema.performanceReview.id, id), eq(schema.performanceReview.organisationId, orgId))).returning();
    await auditWrite(orgId, user.userId, data.status === 'submitted' ? 'submit' : 'update', 'review', id, old, updated, 'performance');
    return this._one(orgId, user, id);
  }

  /** Only the person who was reviewed can acknowledge, and only a submitted review. */
  async acknowledgeReview(orgId, user, id) {
    const [old] = await db.select().from(schema.performanceReview)
      .where(and(eq(schema.performanceReview.id, id), eq(schema.performanceReview.organisationId, orgId), eq(schema.performanceReview.revieweeId, user.userId))).limit(1);
    if (!old || old.status === 'draft') throw new NotFoundError('Review not found');
    if (old.status === 'acknowledged') return this._one(orgId, user, id);

    const [updated] = await db.update(schema.performanceReview)
      .set({ status: 'acknowledged', acknowledgedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.performanceReview.id, id)).returning();
    await auditWrite(orgId, user.userId, 'acknowledge', 'review', id, old, updated, 'performance');
    return this._one(orgId, user, id);
  }

  async _one(orgId, user, id) {
    const all = await this.getReviews(orgId, user, {});
    return all.find((r) => r.id === id);
  }

  // ── Goals ─────────────────────────────────────────────────────────────────
  async _shapeGoals(orgId, rows, user) {
    const [names, teamNames] = await Promise.all([this._userNames(rows.map((g) => g.assignedTo)), this._teamNames(orgId)]);
    return rows.map((g) => {
      const effectiveStatus = math.effectiveGoalStatus(g);
      const m = g.metricKey ? getMetric(g.metricKey) : null;
      return { ...g, isAuto: g.progressSource === 'auto', metric: m ? { key: m.key, label: m.label, unit: m.unit, direction: m.direction, cumulative: m.cumulative } : null, teamName: teamNames.get(g.teamId) || null, assignedToName: names.get(g.assignedTo) || null, effectiveStatus, isOverdue: effectiveStatus === 'overdue', daysLeft: math.daysUntil(g.dueDate), isMine: !!user && g.assignedTo === user.userId };
    });
  }

  async getGoals(orgId, user, { teamId, assignedTo, status } = {}) {
    // Metric goals refresh when read if they haven't been computed in the last few minutes.
    await metrics.syncGoalsForOrg(orgId, { teamIds: visibleTeamIds(user) }).catch((e) => console.error(`[goal-sync] ${e.message}`));
    const conds = [eq(schema.goal.organisationId, orgId)];
    const reach = inTeams(schema.goal.teamId, visibleTeamIds(user));
    if (reach) conds.push(reach);
    if (teamId) conds.push(eq(schema.goal.teamId, teamId));
    if (assignedTo) conds.push(eq(schema.goal.assignedTo, assignedTo));
    const rows = await db.select().from(schema.goal).where(and(...conds)).orderBy(asc(schema.goal.dueDate), desc(schema.goal.createdAt));
    const shaped = await this._shapeGoals(orgId, rows, user);
    return status ? shaped.filter((g) => g.effectiveStatus === status) : shaped;
  }

  async createGoal(orgId, user, data) {
    await this._assertTeamInOrg(orgId, data.teamId);
    if (data.assignedTo) await this._assertTeamMember(orgId, data.teamId, data.assignedTo, 'The person you\'re assigning this to');
    const values = { ...data, organisationId: orgId, createdBy: user.userId };
    if (data.metricKey) {
      const m = getMetric(data.metricKey);
      if (data.assignedTo && !m.userScope) throw new BadRequestError(`${m.label} can only be measured for a whole team. Leave the goal unassigned`);
      values.progressSource = 'auto';
      values.progressPct = 0;
      values.startDate = data.startDate || localDate(new Date(), await metrics.orgTz(orgId));
    }
    let [goal] = await db.insert(schema.goal).values(values).returning();
    await auditWrite(orgId, user.userId, 'create', 'goal', goal.id, null, goal, 'performance');
    if (goal.progressSource === 'auto') goal = await metrics.syncGoal(goal);
    return (await this._shapeGoals(orgId, [goal], user))[0];
  }

  async updateGoal(orgId, user, id, data) {
    const old = await this._load(schema.goal, orgId, user, id, 'Goal', { entity: 'goals', action: 'write' });
    if (data.assignedTo) await this._assertTeamMember(orgId, old.teamId, data.assignedTo, 'The person you\'re assigning this to');
    const isAuto = old.progressSource === 'auto';
    if (!isAuto && (data.targetValue !== undefined || data.startDate !== undefined)) throw new BadRequestError('Only a metric goal has a target and start date');
    if (isAuto && data.progressPct !== undefined) throw new BadRequestError('Progress is computed automatically for this goal');
    if (isAuto && data.assignedTo && !getMetric(old.metricKey).userScope) throw new BadRequestError('That metric can only be measured for a whole team. Leave the goal unassigned');
    const startDate = data.startDate ?? old.startDate; const dueDate = data.dueDate === undefined ? old.dueDate : data.dueDate;
    if (isAuto && (!dueDate || (startDate && startDate > dueDate))) throw new BadRequestError('A metric goal needs a due date after its start date');

    const patch = { ...data, updatedAt: new Date() };
    if (data.status === 'completed') { patch.progressPct = 100; if (old.status !== 'completed') patch.completedAt = new Date(); if (isAuto) patch.finalizedAt = new Date(); }
    if (data.status && data.status !== 'completed') patch.completedAt = null;
    // Changing what is measured, or reopening the goal, puts it back in the automatic loop.
    if (isAuto && (['targetValue', 'startDate', 'dueDate', 'assignedTo'].some((f) => data[f] !== undefined) || (data.status && data.status !== 'completed'))) patch.finalizedAt = null;
    let [updated] = await db.update(schema.goal).set(patch).where(and(eq(schema.goal.id, id), eq(schema.goal.organisationId, orgId))).returning();
    await auditWrite(orgId, user.userId, 'update', 'goal', id, old, updated, 'performance');
    if (isAuto && !updated.finalizedAt) updated = await metrics.syncGoal(updated);
    return (await this._shapeGoals(orgId, [updated], user))[0];
  }

  /** The person a goal is assigned to can report their own progress without edit rights. */
  async updateGoalProgress(orgId, user, id, { progressPct, complete }) {
    const [old] = await db.select().from(schema.goal)
      .where(and(eq(schema.goal.id, id), eq(schema.goal.organisationId, orgId), eq(schema.goal.assignedTo, user.userId))).limit(1);
    if (!old) throw new NotFoundError('Goal not found');
    if (old.progressSource === 'auto') throw new ConflictError('This goal\'s progress is tracked automatically from the pipeline');
    if (old.status === 'completed' || old.status === 'cancelled') throw new ConflictError(`This goal is ${old.status}`);
    const done = complete === true || progressPct === 100;
    const patch = { progressPct: done ? 100 : progressPct, updatedAt: new Date() };
    if (done) { patch.status = 'completed'; patch.completedAt = new Date(); }
    const [updated] = await db.update(schema.goal).set(patch).where(eq(schema.goal.id, id)).returning();
    await auditWrite(orgId, user.userId, 'update', 'goal', id, old, updated, 'performance');
    return (await this._shapeGoals(orgId, [updated], user))[0];
  }

  // ── Strategy ──────────────────────────────────────────────────────────────
  /** The dates key results are measured over: explicit, else read from the period text. */
  _strategyWindow(period, startDate, endDate) {
    if (startDate && endDate) return { start: startDate, end: endDate };
    const p = math.parsePeriod(period);
    return p ? { start: p.start, end: p.end } : null;
  }

  /**
   * Normalise key results and make sure every link points at something in the same
   * org and team. Computed key results never keep a typed `current`; manual ones start at 0.
   */
  async _prepareObjectives(orgId, teamId, objectives, window) {
    const krs = (objectives || []).flatMap((o) => o.key_results || []);
    if (krs.some((k) => k.type === 'metric' || k.type === 'kpi') && !window) {
      throw new BadRequestError('Add a start and end date for this period so the numbers can be measured. A period like "FY2026" can\'t be read automatically');
    }
    const kpiIds = [...new Set(krs.filter((k) => k.type === 'kpi').map((k) => k.kpi_id))];
    const goalIds = [...new Set(krs.filter((k) => k.type === 'goal').flatMap((k) => k.goal_ids))];
    if (kpiIds.length) {
      const rows = await db.select({ id: schema.kpiDefinition.id }).from(schema.kpiDefinition)
        .where(and(eq(schema.kpiDefinition.organisationId, orgId), eq(schema.kpiDefinition.teamId, teamId), inArray(schema.kpiDefinition.id, kpiIds)));
      if (rows.length !== kpiIds.length) throw new BadRequestError('A linked KPI doesn\'t exist in this team');
    }
    if (goalIds.length) {
      const rows = await db.select({ id: schema.goal.id }).from(schema.goal)
        .where(and(eq(schema.goal.organisationId, orgId), eq(schema.goal.teamId, teamId), inArray(schema.goal.id, goalIds)));
      if (rows.length !== goalIds.length) throw new BadRequestError('A linked goal doesn\'t exist in this team');
    }
    return (objectives || []).map((o) => ({
      ...o,
      key_results: (o.key_results || []).map(({ current, ...k }) => (k.type === 'manual' ? { ...k, current: current ?? 0 } : k)),
    }));
  }

  async _shapeStrategies(rows, teamNames) {
    const tz = rows.length ? await metrics.orgTz(rows[0].organisationId) : 'UTC';
    return Promise.all(rows.map(async (s) => {
      const r = await metrics.resolveStrategy(s, { tz });
      return { ...s, teamName: teamNames.get(s.teamId) || null, objectives: r.objectives, progressPct: r.progressPct, window: r.window, isFinal: !!s.finalizedAt };
    }));
  }

  async getStrategies(orgId, user, { teamId, status } = {}) {
    const conds = [eq(schema.teamStrategy.organisationId, orgId)];
    const reach = inTeams(schema.teamStrategy.teamId, visibleTeamIds(user));
    if (reach) conds.push(reach);
    if (teamId) conds.push(eq(schema.teamStrategy.teamId, teamId));
    if (status) conds.push(eq(schema.teamStrategy.status, status));
    const [rows, teamNames] = await Promise.all([
      db.select().from(schema.teamStrategy).where(and(...conds)).orderBy(desc(schema.teamStrategy.createdAt)),
      this._teamNames(orgId),
    ]);
    return this._shapeStrategies(rows, teamNames);
  }

  async createStrategy(orgId, user, data) {
    await this._assertTeamInOrg(orgId, data.teamId);
    const { startDate, endDate, ...rest } = data;
    const window = this._strategyWindow(data.period, startDate, endDate);
    const objectives = await this._prepareObjectives(orgId, data.teamId, data.objectives, window);
    const [strategy] = await db.insert(schema.teamStrategy).values({
      ...rest, objectives, periodStart: window?.start ?? null, periodEnd: window?.end ?? null, organisationId: orgId, createdBy: user.userId,
    }).returning();
    await auditWrite(orgId, user.userId, 'create', 'strategy', strategy.id, null, strategy, 'performance');
    return (await this._shapeStrategies([strategy], await this._teamNames(orgId)))[0];
  }

  async updateStrategy(orgId, user, id, data) {
    const old = await this._load(schema.teamStrategy, orgId, user, id, 'Strategy', { entity: 'strategy', action: 'write' });
    const { startDate, endDate, ...rest } = data;
    const touchesMeasurement = ['objectives', 'period'].some((f) => rest[f] !== undefined) || startDate !== undefined || endDate !== undefined;
    if (old.finalizedAt && touchesMeasurement) {
      throw new ConflictError('This strategy\'s period is over and its results are locked. Start a new strategy for the next period');
    }
    const patch = { ...rest, updatedAt: new Date() };
    if (touchesMeasurement) {
      const period = rest.period ?? old.period;
      const explicit = startDate && endDate ? { start: startDate, end: endDate } : null;
      // Changing the period text re-reads the window; otherwise the stored dates stand.
      const window = explicit || (rest.period !== undefined ? this._strategyWindow(period) : (old.periodStart && old.periodEnd ? { start: old.periodStart, end: old.periodEnd } : this._strategyWindow(period)));
      patch.objectives = await this._prepareObjectives(orgId, old.teamId, rest.objectives ?? old.objectives, window);
      patch.periodStart = window?.start ?? null;
      patch.periodEnd = window?.end ?? null;
    }
    const [updated] = await db.update(schema.teamStrategy).set(patch)
      .where(and(eq(schema.teamStrategy.id, id), eq(schema.teamStrategy.organisationId, orgId))).returning();
    await auditWrite(orgId, user.userId, 'update', 'strategy', id, old, updated, 'performance');
    return (await this._shapeStrategies([updated], await this._teamNames(orgId)))[0];
  }

  // ── Roll-up for dashboards ────────────────────────────────────────────────
  /** Per-team scorecard: how many KPIs are on target, goal status mix, reviews awaiting action. */
  async getOverview(orgId, user) {
    const [kpis, goals, reviews, teamNames] = await Promise.all([
      this.listKpis(orgId, user, {}),
      this.getGoals(orgId, user, {}),
      this.getReviews(orgId, user, {}),
      this._teamNames(orgId),
    ]);
    const reach = visibleTeamIds(user);
    const teamIds = new Set([...kpis, ...goals].map((x) => x.teamId));
    if (reach) reach.forEach((t) => teamIds.add(t));

    const teams = [...teamIds].map((teamId) => {
      const k = kpis.filter((x) => x.teamId === teamId);
      const g = goals.filter((x) => x.teamId === teamId);
      const open = g.filter((x) => x.effectiveStatus === 'active' || x.effectiveStatus === 'overdue');
      return {
        teamId, teamName: teamNames.get(teamId) || null,
        kpis: { total: k.length, onTarget: k.filter((x) => x.health.tone === 'good').length, atRisk: k.filter((x) => x.health.tone === 'warn').length, offTarget: k.filter((x) => x.health.tone === 'bad').length, noData: k.filter((x) => x.latest === null).length },
        goals: { active: g.filter((x) => x.effectiveStatus === 'active').length, overdue: g.filter((x) => x.isOverdue).length, completed: g.filter((x) => x.effectiveStatus === 'completed').length, averageProgressPct: open.length ? Math.round(open.reduce((a, x) => a + x.progressPct, 0) / open.length) : null },
        reviews: { drafts: reviews.filter((x) => x.teamId === teamId && x.status === 'draft').length, awaitingAcknowledgement: reviews.filter((x) => x.teamId === teamId && x.status === 'submitted').length },
      };
    }).sort((a, b) => (a.teamName || '').localeCompare(b.teamName || ''));
    return { teams };
  }
}

module.exports = new PerformanceService();
