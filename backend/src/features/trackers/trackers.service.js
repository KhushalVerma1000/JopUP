const { db, schema } = require('../../utils/db');
const { eq, and, isNull, asc, desc, inArray } = require('drizzle-orm');
const { NotFoundError, BadRequestError, PossibleDuplicateError } = require('../../utils/errors');
const { emitEvent } = require('../../utils/events');
const { auditWrite } = require('../../utils/audit');
const { normalizePhone } = require('../../utils/phone');
const workflowService = require('../workflow/workflow.service');

class TrackersService {
  async getAllTrackers(orgId, filters = {}) {
    const conditions = [eq(schema.candidateTracker.organisationId, orgId)];

    if (filters.status) conditions.push(eq(schema.candidateTracker.status, filters.status));
    if (filters.teamId) conditions.push(eq(schema.candidateTracker.teamId, filters.teamId));
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
        ? db.select({ id: schema.candidate.id, firstName: schema.candidate.firstName, lastName: schema.candidate.lastName, phone: schema.candidate.phone })
            .from(schema.candidate).where(inArray(schema.candidate.id, candidateIds))
        : [],
      openPositionIds.length
        ? db.select({ id: schema.openPosition.id, designation: schema.openPosition.designation, clientId: schema.openPosition.clientId })
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
        openPositionDesignation: position ? position.designation : null,
        clientName: position?.clientId ? clientById.get(position.clientId)?.companyName || null : null,
        currentStage: log ? stageById.get(log.stageId) || null : null,
        currentStageEnteredAt: log ? log.enteredAt : null,
      };
    });
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
    const templates = await workflowService.getTemplates(orgId, teamId);
    const existingDefault = templates.find((t) => t.isDefault);
    if (existingDefault) return existingDefault.id;

    const seeded = await workflowService.seedDefaultWorkflow(orgId, teamId, userId);
    return seeded.id;
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

    const newTracker = await db.transaction((tx) =>
      this.createTrackerTx(tx, orgId, { ...data, workflowTemplateId }, userId)
    );

    await emitEvent(orgId, userId, 'tracker.created', 'candidate_tracker', newTracker.id, newTracker, 'pipeline');
    await auditWrite(orgId, userId, 'create', 'candidate_tracker', newTracker.id, null, newTracker, 'pipeline');

    return newTracker;
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

  async advanceStage(orgId, trackerId, nextStageId, userId) {
    return await db.transaction(async (tx) => {
      const currentLog = await this.getCurrentStage(trackerId);

      if (!currentLog) {
        throw new BadRequestError('Tracker is not currently in any active stage');
      }

      await tx.update(schema.candidateTrackerStageLog)
        .set({ status: 'advanced', exitedAt: new Date() })
        .where(eq(schema.candidateTrackerStageLog.id, currentLog.id));

      const [newLog] = await tx.insert(schema.candidateTrackerStageLog).values({
        trackerId,
        stageId: nextStageId,
        movedBy: userId,
        status: 'active',
      }).returning();

      await emitEvent(orgId, userId, 'candidate.stage_changed', 'candidate_tracker', trackerId, { previousStage: currentLog.stageId, nextStage: nextStageId }, 'pipeline');
      await auditWrite(orgId, userId, 'advance_stage', 'candidate_tracker', trackerId, currentLog, newLog, 'pipeline');

      return newLog;
    });
  }

  async blockTracker(orgId, trackerId, reason, userId) {
    return await db.transaction(async (tx) => {
      const currentLog = await this.getCurrentStage(trackerId);

      if (currentLog) {
        await tx.update(schema.candidateTrackerStageLog)
          .set({ status: 'blocked', exitedAt: new Date(), blockReason: reason })
          .where(eq(schema.candidateTrackerStageLog.id, currentLog.id));
      }

      const [updatedTracker] = await tx.update(schema.candidateTracker)
        .set({ status: 'rejected', updatedAt: new Date() })
        .where(and(eq(schema.candidateTracker.id, trackerId), eq(schema.candidateTracker.organisationId, orgId)))
        .returning();

      await emitEvent(orgId, userId, 'tracker.blocked', 'candidate_tracker', trackerId, { reason }, 'pipeline');
      await auditWrite(orgId, userId, 'block', 'candidate_tracker', trackerId, currentLog, updatedTracker, 'pipeline');

      return updatedTracker;
    });
  }

  async holdTracker(orgId, trackerId, userId) {
    return await db.transaction(async (tx) => {
      const currentLog = await this.getCurrentStage(trackerId);

      if (currentLog) {
        await tx.update(schema.candidateTrackerStageLog)
          .set({ status: 'held', exitedAt: new Date() })
          .where(eq(schema.candidateTrackerStageLog.id, currentLog.id));
      }

      const [updatedTracker] = await tx.update(schema.candidateTracker)
        .set({ status: 'on_hold', updatedAt: new Date() })
        .where(and(eq(schema.candidateTracker.id, trackerId), eq(schema.candidateTracker.organisationId, orgId)))
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
      const [tracker] = await tx.select().from(schema.candidateTracker).where(
        and(eq(schema.candidateTracker.id, trackerId), eq(schema.candidateTracker.organisationId, orgId))
      );
      if (!tracker) throw new NotFoundError('Tracker not found');
      if (tracker.status !== 'on_hold') throw new BadRequestError('Only a tracker that is on hold can be resumed');

      const [lastHeld] = await tx.select().from(schema.candidateTrackerStageLog).where(
        and(eq(schema.candidateTrackerStageLog.trackerId, trackerId), eq(schema.candidateTrackerStageLog.status, 'held'))
      ).orderBy(desc(schema.candidateTrackerStageLog.enteredAt)).limit(1);
      if (!lastHeld) throw new BadRequestError('No held stage found to resume');

      const [newLog] = await tx.insert(schema.candidateTrackerStageLog).values({
        trackerId, stageId: lastHeld.stageId, movedBy: userId, status: 'active',
      }).returning();
      const [updated] = await tx.update(schema.candidateTracker)
        .set({ status: 'active', updatedAt: new Date() })
        .where(eq(schema.candidateTracker.id, trackerId)).returning();

      await auditWrite(orgId, userId, 'resume', 'candidate_tracker', trackerId, tracker, updated, 'pipeline');
      return updated;
    });
  }

  async addStageAction(stageLogId, data, userId) {
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
