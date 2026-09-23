const { db, schema } = require('../../utils/db');
const { eq, and, isNull, asc, inArray } = require('drizzle-orm');
const { NotFoundError, BadRequestError } = require('../../utils/errors');
const { emitEvent } = require('../../utils/events');
const { auditWrite } = require('../../utils/audit');

class ApplicationsService {
  async getAllApplications(orgId, filters = {}) {
    const conditions = [eq(schema.application.organisationId, orgId)];
    
    if (filters.status) conditions.push(eq(schema.application.status, filters.status));
    if (filters.teamId) conditions.push(eq(schema.application.teamId, filters.teamId));
    if (filters.jobPostingId) conditions.push(eq(schema.application.jobPostingId, filters.jobPostingId));
    
    const rows = await db.select().from(schema.application).where(and(...conditions));
    return this._enrichApplications(rows);
  }

  /**
   * A tracker is useless if every row just shows raw UUIDs — this is the
   * same "resolve IDs to names server-side" principle used elsewhere in
   * this codebase (pending-approvals, invitations), applied to the one
   * place it matters most: the applications list is the actual pipeline
   * tracker. Previously getAllApplications returned bare `application`
   * rows with no current-stage, candidate, or job-posting info at all —
   * the caller would have needed one extra request per row (getById does
   * include currentLog) just to know which column of a kanban board a
   * card belongs in. Batched into a handful of queries total, not N+1.
   */
  async _enrichApplications(rows) {
    if (rows.length === 0) return [];

    const appIds = rows.map((r) => r.id);
    const candidateIds = [...new Set(rows.map((r) => r.candidateId).filter(Boolean))];
    const jobPostingIds = [...new Set(rows.map((r) => r.jobPostingId).filter(Boolean))];

    const [currentLogs, candidateRows, jobPostingRows] = await Promise.all([
      db.select().from(schema.applicationStageLog).where(
        and(inArray(schema.applicationStageLog.applicationId, appIds), isNull(schema.applicationStageLog.exitedAt))
      ),
      candidateIds.length
        ? db.select({ id: schema.candidate.id, firstName: schema.candidate.firstName, lastName: schema.candidate.lastName })
            .from(schema.candidate).where(inArray(schema.candidate.id, candidateIds))
        : [],
      jobPostingIds.length
        ? db.select({ id: schema.jobPosting.id, title: schema.jobPosting.title })
            .from(schema.jobPosting).where(inArray(schema.jobPosting.id, jobPostingIds))
        : [],
    ]);

    const stageIds = [...new Set(currentLogs.map((l) => l.stageId).filter(Boolean))];
    const stageRows = stageIds.length
      ? await db.select({ id: schema.workflowStage.id, name: schema.workflowStage.name, stageKey: schema.workflowStage.stageKey, isFinalSuccess: schema.workflowStage.isFinalSuccess })
          .from(schema.workflowStage).where(inArray(schema.workflowStage.id, stageIds))
      : [];

    const stageById = new Map(stageRows.map((s) => [s.id, s]));
    const logByAppId = new Map(currentLogs.map((l) => [l.applicationId, l]));
    const candidateById = new Map(candidateRows.map((c) => [c.id, c]));
    const jobPostingById = new Map(jobPostingRows.map((j) => [j.id, j]));

    return rows.map((app) => {
      const log = logByAppId.get(app.id) || null;
      const candidate = candidateById.get(app.candidateId) || null;
      const jobPosting = app.jobPostingId ? jobPostingById.get(app.jobPostingId) || null : null;
      return {
        ...app,
        candidateName: candidate ? `${candidate.firstName} ${candidate.lastName}` : null,
        jobPostingTitle: jobPosting ? jobPosting.title : null,
        currentStage: log ? stageById.get(log.stageId) || null : null,
        currentStageEnteredAt: log ? log.enteredAt : null,
      };
    });
  }

  async getApplicationById(orgId, id) {
    const app = await db.query.application.findFirst({
      where: and(eq(schema.application.id, id), eq(schema.application.organisationId, orgId))
    });
    
    if (!app) throw new NotFoundError('Application not found');
    
    const currentLog = await this.getCurrentStage(id);
    
    return { ...app, currentLog };
  }

  async createApplication(orgId, data, userId) {
    return await db.transaction(async (tx) => {
      // 1. Create Application
      const [newApp] = await tx.insert(schema.application).values({
        ...data,
        organisationId: orgId,
        status: 'active'
      }).returning();

      // 2. Find the first stage of the workflow
      const firstStage = await tx.query.workflowStage.findFirst({
        where: eq(schema.workflowStage.workflowTemplateId, data.workflowTemplateId),
        orderBy: [asc(schema.workflowStage.orderIndex)]
      });

      if (!firstStage) {
        throw new BadRequestError('Workflow template has no stages');
      }

      // 3. Insert first stage log
      await tx.insert(schema.applicationStageLog).values({
        applicationId: newApp.id,
        stageId: firstStage.id,
        status: 'active'
      });

      await emitEvent(orgId, userId, 'application.created', 'application', newApp.id, newApp, 'pipeline');
      await auditWrite(orgId, userId, 'create', 'application', newApp.id, null, newApp, 'pipeline');
      
      return newApp;
    });
  }

  async getCurrentStage(applicationId) {
    const logs = await db.select()
      .from(schema.applicationStageLog)
      .where(and(
        eq(schema.applicationStageLog.applicationId, applicationId),
        isNull(schema.applicationStageLog.exitedAt)
      ));
      
    return logs[0] || null;
  }

  async advanceStage(orgId, applicationId, nextStageId, userId) {
    return await db.transaction(async (tx) => {
      const currentLog = await this.getCurrentStage(applicationId);
      
      if (!currentLog) {
        throw new BadRequestError('Application is not currently in any active stage');
      }

      // Close current stage
      await tx.update(schema.applicationStageLog)
        .set({ status: 'advanced', exitedAt: new Date() })
        .where(eq(schema.applicationStageLog.id, currentLog.id));

      // Open new stage
      const [newLog] = await tx.insert(schema.applicationStageLog).values({
        applicationId,
        stageId: nextStageId,
        movedBy: userId,
        status: 'active'
      }).returning();

      await emitEvent(orgId, userId, 'candidate.stage_changed', 'application', applicationId, { previousStage: currentLog.stageId, nextStage: nextStageId }, 'pipeline');
      await auditWrite(orgId, userId, 'advance_stage', 'application', applicationId, currentLog, newLog, 'pipeline');
      
      return newLog;
    });
  }

  async blockApplication(orgId, applicationId, reason, userId) {
    return await db.transaction(async (tx) => {
      const currentLog = await this.getCurrentStage(applicationId);
      
      if (currentLog) {
        await tx.update(schema.applicationStageLog)
          .set({ status: 'blocked', exitedAt: new Date(), blockReason: reason })
          .where(eq(schema.applicationStageLog.id, currentLog.id));
      }

      const [updatedApp] = await tx.update(schema.application)
        .set({ status: 'rejected', updatedAt: new Date() })
        .where(and(eq(schema.application.id, applicationId), eq(schema.application.organisationId, orgId)))
        .returning();

      await emitEvent(orgId, userId, 'application.blocked', 'application', applicationId, { reason }, 'pipeline');
      await auditWrite(orgId, userId, 'block', 'application', applicationId, currentLog, updatedApp, 'pipeline');
      
      return updatedApp;
    });
  }

  async holdApplication(orgId, applicationId, userId) {
    return await db.transaction(async (tx) => {
      const currentLog = await this.getCurrentStage(applicationId);
      
      if (currentLog) {
        await tx.update(schema.applicationStageLog)
          .set({ status: 'held', exitedAt: new Date() })
          .where(eq(schema.applicationStageLog.id, currentLog.id));
      }

      const [updatedApp] = await tx.update(schema.application)
        .set({ status: 'on_hold', updatedAt: new Date() })
        .where(and(eq(schema.application.id, applicationId), eq(schema.application.organisationId, orgId)))
        .returning();

      await auditWrite(orgId, userId, 'hold', 'application', applicationId, currentLog, updatedApp, 'pipeline');
      
      return updatedApp;
    });
  }

  async addStageAction(logId, data, userId) {
    const [action] = await db.insert(schema.stageAction).values({
      ...data,
      applicationStageLogId: logId,
      performedBy: userId
    }).returning();
    
    return action;
  }

  async getStageHistory(applicationId) {
    return await db.select()
      .from(schema.applicationStageLog)
      .where(eq(schema.applicationStageLog.applicationId, applicationId))
      .orderBy(asc(schema.applicationStageLog.enteredAt));
  }
}

module.exports = new ApplicationsService();
