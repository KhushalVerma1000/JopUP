const { db, schema } = require('../../utils/db');
const { eq, and, isNull, asc } = require('drizzle-orm');
const { NotFoundError, BadRequestError } = require('../../utils/errors');
const { emitEvent } = require('../../utils/events');
const { auditWrite } = require('../../utils/audit');

class ApplicationsService {
  async getAllApplications(orgId, filters = {}) {
    const conditions = [eq(schema.application.organisationId, orgId)];
    
    if (filters.status) conditions.push(eq(schema.application.status, filters.status));
    if (filters.teamId) conditions.push(eq(schema.application.teamId, filters.teamId));
    if (filters.jobPostingId) conditions.push(eq(schema.application.jobPostingId, filters.jobPostingId));
    
    return await db.select().from(schema.application).where(and(...conditions));
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
