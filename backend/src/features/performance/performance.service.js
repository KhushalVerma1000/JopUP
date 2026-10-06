const { db, schema } = require('../../utils/db');
const { eq, and, or, ne, inArray, asc, desc, sql } = require('drizzle-orm');
const { NotFoundError, BadRequestError, ConflictError } = require('../../utils/errors');
const { auditWrite } = require('../../utils/audit');
const { visibleTeamIds, teamsWithPermission } = require('../../utils/teamScope');
const math = require('./performance.math');

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

    const defs = await db.select().from(schema.kpiDefinition).where(and(...conds)).orderBy(asc(schema.kpiDefinition.name));
    if (!defs.length) return [];

    const ids = defs.map((d) => d.id);
    const [{ rows }, teamNames] = await Promise.all([
      db.execute(sql`
        select kpi_id, value, period_label, period_date::text as period_date
        from (
          select kpi_id, value, period_label, period_date, created_at,
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
      byKpi.get(r.kpi_id).push({ value: Number(r.value), periodLabel: r.period_label, periodDate: r.period_date });
    }

    return defs.map((d) => {
      const recent = byKpi.get(d.id) || [];
      const latest = recent[recent.length - 1] || null;
      const previous = recent.length > 1 ? recent[recent.length - 2] : null;
      const delta = math.changePct(previous?.value, latest?.value);
      return {
        ...d,
        isActive: kpiActive(d),
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
    const [kpi] = await db.insert(schema.kpiDefinition).values({ ...data, organisationId: orgId, createdBy: userId }).returning();
    await auditWrite(orgId, userId, 'create', 'kpi', kpi.id, null, kpi, 'performance');
    return { ...kpi, isActive: kpiActive(kpi) };
  }

  async updateKpiDefinition(orgId, user, id, data) {
    const old = await this._load(schema.kpiDefinition, orgId, user, id, 'KPI', { entity: 'kpi', action: 'write' });
    const { isActive, ...rest } = data;
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

    const periodDate = data.periodDate || math.todayDate();
    const periodLabel = data.periodLabel || math.defaultPeriodLabel(kpi.frequency, periodDate);

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
      return { ...g, teamName: teamNames.get(g.teamId) || null, assignedToName: names.get(g.assignedTo) || null, effectiveStatus, isOverdue: effectiveStatus === 'overdue', daysLeft: math.daysUntil(g.dueDate), isMine: !!user && g.assignedTo === user.userId };
    });
  }

  async getGoals(orgId, user, { teamId, assignedTo, status } = {}) {
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
    const [goal] = await db.insert(schema.goal).values({ ...data, organisationId: orgId, createdBy: user.userId }).returning();
    await auditWrite(orgId, user.userId, 'create', 'goal', goal.id, null, goal, 'performance');
    return (await this._shapeGoals(orgId, [goal], user))[0];
  }

  async updateGoal(orgId, user, id, data) {
    const old = await this._load(schema.goal, orgId, user, id, 'Goal', { entity: 'goals', action: 'write' });
    if (data.assignedTo) await this._assertTeamMember(orgId, old.teamId, data.assignedTo, 'The person you\'re assigning this to');
    const patch = { ...data, updatedAt: new Date() };
    if (data.status === 'completed') { patch.progressPct = 100; if (old.status !== 'completed') patch.completedAt = new Date(); }
    if (data.status && data.status !== 'completed') patch.completedAt = null;
    const [updated] = await db.update(schema.goal).set(patch).where(and(eq(schema.goal.id, id), eq(schema.goal.organisationId, orgId))).returning();
    await auditWrite(orgId, user.userId, 'update', 'goal', id, old, updated, 'performance');
    return (await this._shapeGoals(orgId, [updated], user))[0];
  }

  /** The person a goal is assigned to can report their own progress without edit rights. */
  async updateGoalProgress(orgId, user, id, { progressPct, complete }) {
    const [old] = await db.select().from(schema.goal)
      .where(and(eq(schema.goal.id, id), eq(schema.goal.organisationId, orgId), eq(schema.goal.assignedTo, user.userId))).limit(1);
    if (!old) throw new NotFoundError('Goal not found');
    if (old.status === 'completed' || old.status === 'cancelled') throw new ConflictError(`This goal is ${old.status}`);
    const done = complete === true || progressPct === 100;
    const patch = { progressPct: done ? 100 : progressPct, updatedAt: new Date() };
    if (done) { patch.status = 'completed'; patch.completedAt = new Date(); }
    const [updated] = await db.update(schema.goal).set(patch).where(eq(schema.goal.id, id)).returning();
    await auditWrite(orgId, user.userId, 'update', 'goal', id, old, updated, 'performance');
    return (await this._shapeGoals(orgId, [updated], user))[0];
  }

  // ── Strategy ──────────────────────────────────────────────────────────────
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
    return rows.map((s) => {
      const krs = (s.objectives || []).flatMap((o) => o.key_results || []);
      const pcts = krs.filter((k) => k.target).map((k) => Math.min(100, ((k.current || 0) / k.target) * 100));
      return { ...s, teamName: teamNames.get(s.teamId) || null, progressPct: pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null };
    });
  }

  async createStrategy(orgId, user, data) {
    await this._assertTeamInOrg(orgId, data.teamId);
    const objectives = (data.objectives || []).map((o) => ({ ...o, key_results: o.key_results.map((k) => ({ ...k, current: k.current ?? 0 })) }));
    const [strategy] = await db.insert(schema.teamStrategy).values({ ...data, objectives, organisationId: orgId, createdBy: user.userId }).returning();
    await auditWrite(orgId, user.userId, 'create', 'strategy', strategy.id, null, strategy, 'performance');
    return strategy;
  }

  async updateStrategy(orgId, user, id, data) {
    const old = await this._load(schema.teamStrategy, orgId, user, id, 'Strategy', { entity: 'strategy', action: 'write' });
    const [updated] = await db.update(schema.teamStrategy).set({ ...data, updatedAt: new Date() })
      .where(and(eq(schema.teamStrategy.id, id), eq(schema.teamStrategy.organisationId, orgId))).returning();
    await auditWrite(orgId, user.userId, 'update', 'strategy', id, old, updated, 'performance');
    return updated;
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
