const { db, schema } = require('../../utils/db');
const { eq, and, isNull, asc, desc, inArray, sql } = require('drizzle-orm');
const { NotFoundError, BadRequestError, ConflictError, PossibleDuplicateError } = require('../../utils/errors');
const { canSeeTeam } = require('../../utils/teamScope');
const { emitEvent } = require('../../utils/events');
const { auditWrite } = require('../../utils/audit');
const { normalizePhone } = require('../../utils/phone');
const workflowService = require('../workflow/workflow.service');

const LIVE_TAG_CONFLICT = 'This candidate is already tagged to that position';

// pg unique_violation. drizzle may wrap the driver error, so look at .cause too.
const isUniqueViolation = (err) => (err?.code || err?.cause?.code) === '23505';

class TrackersService {
  async getAllTrackers(orgId, filters = {}) {
    const conditions = [eq(schema.candidateTracker.organisationId, orgId)];

    if (filters.status) conditions.push(eq(schema.candidateTracker.status, filters.status));
    if (filters.teamId) conditions.push(eq(schema.candidateTracker.teamId, filters.teamId));
    // null/undefined = unrestricted (org admin); an array limits to those teams
    // (an empty array legitimately matches nothing).
    if (Array.isArray(filters.teamIds)) {
      if (filters.teamIds.length === 0) return [];
      conditions.push(inArray(schema.candidateTracker.teamId, filters.teamIds));
    }
    if (filters.openPositionId) conditions.push(eq(schema.candidateTracker.openPositionId, filters.openPositionId));

    const rows = await db.select().from(schema.candidateTracker).where(and(...conditions));
    return this._enrichTrackers(rows);
  }

  /**
   * Same "resolve IDs to names server-side" principle the old
   * applications.service._enrichApplications used — a tracker list is
   * useless as raw UUIDs. Batched, not N+1.
   */
  async _enrichTrackers(rows) {
    if (rows.length === 0) return [];

    const trackerIds = rows.map((r) => r.id);
    const candidateIds = [...new Set(rows.map((r) => r.candidateId).filter(Boolean))];
    const openPositionIds = [...new Set(rows.map((r) => r.openPositionId).filter(Boolean))];

    const [currentLogs, candidateRows, positionRows] = await Promise.all([
      db.select().from(schema.candidateTrackerStageLog).where(
        and(inArray(schema.candidateTrackerStageLog.trackerId, trackerIds), isNull(schema.candidateTrackerStageLog.exitedAt))
      ),
      candidateIds.length
        ? db.select({ id: schema.candidate.id, firstName: schema.candidate.firstName, lastName: schema.candidate.lastName, phone: schema.candidate.phone, phoneNormalized: schema.candidate.phoneNormalized, location: schema.candidate.location })
            .from(schema.candidate).where(inArray(schema.candidate.id, candidateIds))
        : [],
      openPositionIds.length
        ? db.select({ id: schema.openPosition.id, designation: schema.openPosition.designation, clientId: schema.openPosition.clientId, location: schema.openPosition.location })
            .from(schema.openPosition).where(inArray(schema.openPosition.id, openPositionIds))
        : [],
    ]);

    const stageIds = [...new Set(currentLogs.map((l) => l.stageId).filter(Boolean))];
    const stageRows = stageIds.length
      ? await db.select({ id: schema.workflowStage.id, name: schema.workflowStage.name, stageKey: schema.workflowStage.stageKey, isFinalSuccess: schema.workflowStage.isFinalSuccess })
          .from(schema.workflowStage).where(inArray(schema.workflowStage.id, stageIds))
      : [];

    const clientIds = [...new Set(positionRows.map((p) => p.clientId).filter(Boolean))];
    const clientRows = clientIds.length
      ? await db.select({ id: schema.client.id, companyName: schema.client.companyName })
          .from(schema.client).where(inArray(schema.client.id, clientIds))
      : [];

    const stageById = new Map(stageRows.map((s) => [s.id, s]));
    const logByTrackerId = new Map(currentLogs.map((l) => [l.trackerId, l]));
    const candidateById = new Map(candidateRows.map((c) => [c.id, c]));
    const positionById = new Map(positionRows.map((p) => [p.id, p]));
    const clientById = new Map(clientRows.map((c) => [c.id, c]));

    return rows.map((tracker) => {
      const log = logByTrackerId.get(tracker.id) || null;
      const candidate = candidateById.get(tracker.candidateId) || null;
      const position = tracker.openPositionId ? positionById.get(tracker.openPositionId) || null : null;
      return {
        ...tracker,
        candidateName: candidate ? [candidate.firstName, candidate.lastName].filter(Boolean).join(' ') : null,
        candidatePhone: candidate ? candidate.phone : null,
        // E.164 — what wa.me needs; null for older rows that never got normalised.
        candidatePhoneE164: candidate ? candidate.phoneNormalized : null,
        candidateLocation: candidate ? candidate.location : null,
        openPositionDesignation: position ? position.designation : null,
        openPositionLocation: position ? position.location : null,
        clientName: position?.clientId ? clientById.get(position.clientId)?.companyName || null : null,
        currentStage: log ? stageById.get(log.stageId) || null : null,
        currentStageEnteredAt: log ? log.enteredAt : null,
        // The status HR attached when moving the candidate here ("Reached"…).
        currentStageNote: log ? log.notes : null,
      };
    });
  }

  /**
   * Every mutation below is addressed by tracker id alone, and the stage-log
   * helpers don't filter by org — so confirm the tracker is this tenant's
   * before touching anything. Throws NotFoundError (not Forbidden) so ids
   * from other orgs are indistinguishable from ids that don't exist.
   */
  async _assertTracker(orgId, trackerId, user) {
    const tracker = await db.query.candidateTracker.findFirst({
      where: and(eq(schema.candidateTracker.id, trackerId), eq(schema.candidateTracker.organisationId, orgId)),
    });
    // Out-of-team looks exactly like nonexistent: don't confirm the id exists.
    if (!tracker || (user && !canSeeTeam(user, tracker.teamId))) throw new NotFoundError('Tracker not found');
    return tracker;
  }

  /**
   * Lock the tracker row for the rest of this transaction and return it.
   * Every stage transition goes through here so two requests on one tracker
   * (a double-tap, or two HRs) run one after the other instead of both
   * reading "current stage = X" and both moving on from it — which left a
   * candidate open in several stages at once.
   */
  async _lockTracker(tx, orgId, trackerId) {
    const [tracker] = await tx.select().from(schema.candidateTracker)
      .where(and(eq(schema.candidateTracker.id, trackerId), eq(schema.candidateTracker.organisationId, orgId)))
      .for('update');
    if (!tracker) throw new NotFoundError('Tracker not found');
    return tracker;
  }

  async _currentLogTx(tx, trackerId) {
    const [log] = await tx.select().from(schema.candidateTrackerStageLog).where(and(
      eq(schema.candidateTrackerStageLog.trackerId, trackerId),
      isNull(schema.candidateTrackerStageLog.exitedAt),
    ));
    return log || null;
  }

  /** The position must exist in this org and belong to the tracker's team. */
  async _assertPositionForTeam(orgId, openPositionId, teamId) {
    const position = await db.query.openPosition.findFirst({
      where: and(eq(schema.openPosition.id, openPositionId), eq(schema.openPosition.organisationId, orgId)),
    });
    if (!position) throw new NotFoundError('Open position not found');
    if (position.teamId !== teamId) throw new BadRequestError('That position belongs to a different team');
    if (position.status !== 'open') throw new BadRequestError(`That position is ${String(position.status).replace('_', ' ')} — reopen it before tagging candidates`);
    return position;
  }

  async getTrackerById(orgId, id) {
    const tracker = await db.query.candidateTracker.findFirst({
      where: and(eq(schema.candidateTracker.id, id), eq(schema.candidateTracker.organisationId, orgId)),
    });

    if (!tracker) throw new NotFoundError('Tracker not found');

    const currentLog = await this.getCurrentStage(id);

    return { ...tracker, currentLog };
  }

  /**
   * Stage-count summary for the tracker board — one query per stage
   * bucket, powers the "Lined up: 4, Interview: 2, ..." cards the HR
   * workbench renders instead of a raw list.
   */
  async getSummary(orgId, filters = {}) {
    const trackers = await this.getAllTrackers(orgId, filters);
    const counts = {};
    for (const t of trackers) {
      const key = t.currentStage?.stageKey || t.status;
      counts[key] = (counts[key] || 0) + 1;
    }
    return { total: trackers.length, byStage: counts };
  }

  /**
   * Resolves the workflow template to use for a new tracker: an explicit
   * one, else the team's default, auto-provisioning it via
   * workflowService.seedDefaultWorkflow the first time a team needs one
   * and has none — HR never has to touch templates directly. See
   * 06-workflow.ts's docstring for the fixed default stage sequence.
   */
  async resolveWorkflowTemplateId(orgId, teamId, userId) {
    const findDefault = async () => (await workflowService.getTemplates(orgId, teamId)).find((t) => t.isDefault);

    const existing = await findDefault();
    if (existing) return existing.id;

    try {
      return (await workflowService.seedDefaultWorkflow(orgId, teamId, userId)).id;
    } catch (err) {
      // Lost the race to another request provisioning the same team's default
      // (wt_one_default_per_team). Their transaction is committed by now —
      // the unique index waits for it — so just use theirs.
      if (!isUniqueViolation(err)) throw err;
      const winner = await findDefault();
      if (winner) return winner.id;
      throw err;
    }
  }

  /**
   * Shared create path used both by createTracker (HR quick-add / direct
   * tracking) and by applications.service.createApplication (candidate
   * applied via a job posting) — one engine, one creation path, so a
   * tracker is always created the same way regardless of entry route.
   * Takes an open transaction so the caller can create a linked row
   * (e.g. application) in the same atomic operation.
   */
  async createTrackerTx(tx, orgId, data, userId) {
    let candidateId = data.candidateId;

    if (data.openPositionId) {
      await this._assertPositionForTeam(orgId, data.openPositionId, data.teamId);
    }

    if (candidateId) {
      const existingCandidate = await tx.query.candidate.findFirst({
        where: and(eq(schema.candidate.id, candidateId), eq(schema.candidate.organisationId, orgId)),
      });
      if (!existingCandidate) throw new NotFoundError('Candidate not found');

      // Same candidate, same position, still in play → it's a double-tag.
      if (data.openPositionId) {
        const live = await tx.select({ id: schema.candidateTracker.id }).from(schema.candidateTracker).where(and(
          eq(schema.candidateTracker.candidateId, candidateId),
          eq(schema.candidateTracker.openPositionId, data.openPositionId),
          inArray(schema.candidateTracker.status, ['active', 'on_hold']),
        )).limit(1);
        if (live.length) throw new ConflictError(LIVE_TAG_CONFLICT);
      }
    }

    if (!candidateId) {
      if (!data.candidate?.firstName || !data.candidate?.phone) {
        throw new BadRequestError('candidateId or an inline candidate with firstName and phone is required');
      }

      // ADR-2: same phone-only dedup check as candidates.service.js's
      // createCandidate — the quick-add path is the one most likely to
      // produce duplicates (busy HR, no email to anchor on), so it gets
      // the same check, not a lighter one.
      const phoneNormalized = normalizePhone(data.candidate.phone, data.candidate.phoneCountry);
      if (phoneNormalized && !data.candidate.confirmDuplicate) {
        const existingByPhone = await tx.query.candidate.findFirst({
          where: and(
            eq(schema.candidate.phoneNormalized, phoneNormalized),
            eq(schema.candidate.organisationId, orgId)
          ),
        });
        if (existingByPhone) {
          throw new PossibleDuplicateError(existingByPhone);
        }
      }

      const [newCandidate] = await tx.insert(schema.candidate).values({
        organisationId: orgId,
        ownerTeamId: data.teamId,
        firstName: data.candidate.firstName,
        lastName: data.candidate.lastName || null,
        location: data.candidate.location || null,
        phone: data.candidate.phone,
        phoneCountry: data.candidate.phoneCountry,
        phoneNormalized,
        source: 'manual',
        status: 'active',
        createdBy: userId,
      }).returning();
      candidateId = newCandidate.id;
    }

    const [newTracker] = await tx.insert(schema.candidateTracker).values({
      organisationId: orgId,
      teamId: data.teamId,
      candidateId,
      openPositionId: data.openPositionId || null,
      workflowTemplateId: data.workflowTemplateId,
      assignedHr: data.assignedHr || userId,
      notes: data.notes,
      interviewDate: data.interviewDate,
      lineupDate: data.lineupDate,
      status: 'active',
    }).returning();

    const firstStage = await tx.query.workflowStage.findFirst({
      where: eq(schema.workflowStage.workflowTemplateId, data.workflowTemplateId),
      orderBy: [asc(schema.workflowStage.orderIndex)],
    });

    if (!firstStage) {
      throw new BadRequestError('Workflow template has no stages');
    }

    await tx.insert(schema.candidateTrackerStageLog).values({
      trackerId: newTracker.id,
      stageId: firstStage.id,
      status: 'active',
    });

    return newTracker;
  }

  async createTracker(orgId, data, userId) {
    const workflowTemplateId = data.workflowTemplateId || await this.resolveWorkflowTemplateId(orgId, data.teamId, userId);

    let newTracker;
    try {
      newTracker = await db.transaction((tx) =>
        this.createTrackerTx(tx, orgId, { ...data, workflowTemplateId }, userId)
      );
    } catch (err) {
      // Two concurrent requests passed the friendly check above; the partial
      // unique index (ctr_one_live_tag_uq) is the actual guarantee.
      if (isUniqueViolation(err)) throw new ConflictError(LIVE_TAG_CONFLICT);
      throw err;
    }

    await emitEvent(orgId, userId, 'tracker.created', 'candidate_tracker', newTracker.id, newTracker, 'pipeline');
    await auditWrite(orgId, userId, 'create', 'candidate_tracker', newTracker.id, null, newTracker, 'pipeline');

    return newTracker;
  }

  async updateTracker(orgId, trackerId, data, userId) {
    const before = await this._assertTracker(orgId, trackerId);

    if (data.openPositionId) {
      await this._assertPositionForTeam(orgId, data.openPositionId, before.teamId);
      const dup = await db.select({ id: schema.candidateTracker.id }).from(schema.candidateTracker).where(and(
        eq(schema.candidateTracker.candidateId, before.candidateId),
        eq(schema.candidateTracker.openPositionId, data.openPositionId),
        inArray(schema.candidateTracker.status, ['active', 'on_hold']),
      )).limit(1);
      if (dup.length && dup[0].id !== trackerId) throw new ConflictError('This candidate is already tagged to that position');
    }

    const patch = { updatedAt: new Date() };
    for (const key of ['openPositionId', 'interviewDate', 'lineupDate', 'notes']) {
      if (data[key] !== undefined) patch[key] = key.endsWith('Date') && data[key] ? new Date(data[key]) : data[key];
    }

    let updated;
    try {
      [updated] = await db.update(schema.candidateTracker).set(patch)
        .where(and(eq(schema.candidateTracker.id, trackerId), eq(schema.candidateTracker.organisationId, orgId)))
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError(LIVE_TAG_CONFLICT);
      throw err;
    }

    await auditWrite(orgId, userId, 'update', 'candidate_tracker', trackerId, before, updated, 'pipeline');
    return updated;
  }

  async getCurrentStage(trackerId) {
    const logs = await db.select()
      .from(schema.candidateTrackerStageLog)
      .where(and(
        eq(schema.candidateTrackerStageLog.trackerId, trackerId),
        isNull(schema.candidateTrackerStageLog.exitedAt)
      ));

    return logs[0] || null;
  }

  /**
   * Move a candidate to a later stage. Runs under a row lock on the tracker
   * (see _lockTracker) and re-reads everything it validates *inside* that
   * lock, so concurrent moves can't both succeed.
   */
  async advanceStage(orgId, trackerId, nextStageId, userId, note) {
    return await db.transaction(async (tx) => {
      const tracker = await this._lockTracker(tx, orgId, trackerId);

      if (tracker.status !== 'active') {
        throw new BadRequestError(`This candidate is ${String(tracker.status).replace('_', ' ')} — they can't be moved to another stage`);
      }

      const target = await tx.query.workflowStage.findFirst({ where: eq(schema.workflowStage.id, nextStageId) });
      if (!target || target.workflowTemplateId !== tracker.workflowTemplateId) {
        throw new BadRequestError('That stage is not part of this candidate\'s workflow');
      }

      const currentLog = await this._currentLogTx(tx, trackerId);
      if (!currentLog) throw new BadRequestError('Tracker is not currently in any active stage');

      const current = await tx.query.workflowStage.findFirst({ where: eq(schema.workflowStage.id, currentLog.stageId) });
      if (current && target.id === current.id) {
        throw new ConflictError(`Already in ${current.name} — refresh to see the latest`);
      }
      if (current && target.orderIndex < current.orderIndex) {
        throw new BadRequestError(`Pick a stage after ${current.name}`);
      }

      await tx.update(schema.candidateTrackerStageLog)
        .set({ status: 'advanced', exitedAt: new Date() })
        .where(eq(schema.candidateTrackerStageLog.id, currentLog.id));

      const [newLog] = await tx.insert(schema.candidateTrackerStageLog).values({
        trackerId,
        stageId: nextStageId,
        movedBy: userId,
        status: 'active',
        notes: note || null,
      }).returning();

      // Reaching the final-success stage (Joined) is what "placed" means —
      // it's what open_position.filledCount counts, so it has to be set here.
      if (target.isFinalSuccess) {
        await tx.update(schema.candidateTracker)
          .set({ status: 'placed', updatedAt: new Date() })
          .where(eq(schema.candidateTracker.id, trackerId));
      }

      await emitEvent(orgId, userId, 'candidate.stage_changed', 'candidate_tracker', trackerId, { previousStage: currentLog.stageId, nextStage: nextStageId }, 'pipeline');
      await auditWrite(orgId, userId, 'advance_stage', 'candidate_tracker', trackerId, currentLog, newLog, 'pipeline');

      return newLog;
    });
  }

  async blockTracker(orgId, trackerId, reason, userId) {
    return await db.transaction(async (tx) => {
      const tracker = await this._lockTracker(tx, orgId, trackerId);
      if (!['active', 'on_hold'].includes(tracker.status)) {
        throw new BadRequestError(`This candidate is already ${String(tracker.status).replace('_', ' ')}`);
      }

      const currentLog = await this._currentLogTx(tx, trackerId);
      if (currentLog) {
        await tx.update(schema.candidateTrackerStageLog)
          .set({ status: 'blocked', exitedAt: new Date(), blockReason: reason })
          .where(eq(schema.candidateTrackerStageLog.id, currentLog.id));
      }

      const [updatedTracker] = await tx.update(schema.candidateTracker)
        .set({ status: 'rejected', updatedAt: new Date() })
        .where(eq(schema.candidateTracker.id, trackerId))
        .returning();

      await emitEvent(orgId, userId, 'tracker.blocked', 'candidate_tracker', trackerId, { reason }, 'pipeline');
      await auditWrite(orgId, userId, 'block', 'candidate_tracker', trackerId, currentLog, updatedTracker, 'pipeline');

      return updatedTracker;
    });
  }

  async holdTracker(orgId, trackerId, userId) {
    return await db.transaction(async (tx) => {
      const tracker = await this._lockTracker(tx, orgId, trackerId);
      if (tracker.status !== 'active') {
        throw new BadRequestError(`Only an active candidate can be put on hold (this one is ${String(tracker.status).replace('_', ' ')})`);
      }

      const currentLog = await this._currentLogTx(tx, trackerId);
      if (currentLog) {
        await tx.update(schema.candidateTrackerStageLog)
          .set({ status: 'held', exitedAt: new Date() })
          .where(eq(schema.candidateTrackerStageLog.id, currentLog.id));
      }

      const [updatedTracker] = await tx.update(schema.candidateTracker)
        .set({ status: 'on_hold', updatedAt: new Date() })
        .where(eq(schema.candidateTracker.id, trackerId))
        .returning();

      await auditWrite(orgId, userId, 'hold', 'candidate_tracker', trackerId, currentLog, updatedTracker, 'pipeline');

      return updatedTracker;
    });
  }

  /**
   * Counterpart to holdTracker: holding closes the current stage log and
   * flips the tracker to 'on_hold', which left no way back (advanceStage
   * needs an open log). Resuming re-opens the most recently held stage.
   */
  async resumeTracker(orgId, trackerId, userId) {
    return await db.transaction(async (tx) => {
      const tracker = await this._lockTracker(tx, orgId, trackerId);
      if (tracker.status !== 'on_hold') throw new BadRequestError('Only a tracker that is on hold can be resumed');

      const [lastHeld] = await tx.select().from(schema.candidateTrackerStageLog).where(
        and(eq(schema.candidateTrackerStageLog.trackerId, trackerId), eq(schema.candidateTrackerStageLog.status, 'held'))
      ).orderBy(desc(schema.candidateTrackerStageLog.enteredAt)).limit(1);
      if (!lastHeld) throw new BadRequestError('No held stage found to resume');

      // Carry the status note across, so "Reached" survives a hold/resume.
      await tx.insert(schema.candidateTrackerStageLog).values({
        trackerId, stageId: lastHeld.stageId, movedBy: userId, status: 'active', notes: lastHeld.notes,
      });
      const [updated] = await tx.update(schema.candidateTracker)
        .set({ status: 'active', updatedAt: new Date() })
        .where(eq(schema.candidateTracker.id, trackerId)).returning();

      await auditWrite(orgId, userId, 'resume', 'candidate_tracker', trackerId, tracker, updated, 'pipeline');
      return updated;
    });
  }

  /**
   * Tag many candidates to one position in a single call.
   *
   * Why a server-side bulk op rather than N client requests: the position and
   * default workflow are resolved once, the caller gets one round trip, and
   * the answer is explicit per candidate — tagged / skipped (already live on
   * this position) / failed — instead of the client reverse-engineering
   * partial failure from N responses. Each candidate is its own transaction,
   * so one bad row doesn't roll back the rest.
   */
  async tagCandidates(orgId, { teamId, openPositionId, candidateIds }, userId) {
    await this._assertPositionForTeam(orgId, openPositionId, teamId);
    const workflowTemplateId = await this.resolveWorkflowTemplateId(orgId, teamId, userId);

    const result = { tagged: [], skipped: [], failed: [] };
    for (const candidateId of [...new Set(candidateIds)]) {
      try {
        const tracker = await db.transaction((tx) =>
          this.createTrackerTx(tx, orgId, { teamId, candidateId, openPositionId, workflowTemplateId }, userId));
        await emitEvent(orgId, userId, 'tracker.created', 'candidate_tracker', tracker.id, tracker, 'pipeline');
        await auditWrite(orgId, userId, 'create', 'candidate_tracker', tracker.id, null, tracker, 'pipeline');
        result.tagged.push({ candidateId, trackerId: tracker.id });
      } catch (err) {
        if (err instanceof ConflictError || isUniqueViolation(err)) result.skipped.push({ candidateId, reason: 'Already tagged to this position' });
        else result.failed.push({ candidateId, message: err.message || 'Could not tag this candidate' });
      }
    }
    return result;
  }

  /** Log a call / note against a stage — only if that stage belongs to this tracker. */
  async addStageAction(orgId, trackerId, stageLogId, data, userId, user) {
    await this._assertTracker(orgId, trackerId, user);
    const log = await db.query.candidateTrackerStageLog.findFirst({
      where: and(eq(schema.candidateTrackerStageLog.id, stageLogId), eq(schema.candidateTrackerStageLog.trackerId, trackerId)),
    });
    if (!log) throw new NotFoundError('Stage not found for this tracker');

    const [action] = await db.insert(schema.candidateTrackerAction).values({
      ...data,
      stageLogId,
      performedBy: userId,
    }).returning();

    return action;
  }

  async getStageHistory(trackerId) {
    return await db.select()
      .from(schema.candidateTrackerStageLog)
      .where(eq(schema.candidateTrackerStageLog.trackerId, trackerId))
      .orderBy(asc(schema.candidateTrackerStageLog.enteredAt));
  }
}

module.exports = new TrackersService();
