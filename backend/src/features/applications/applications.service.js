const { db, schema } = require('../../utils/db');
const { eq, and, inArray } = require('drizzle-orm');
const { NotFoundError } = require('../../utils/errors');
const { emitEvent } = require('../../utils/events');
const { auditWrite } = require('../../utils/audit');
const trackersService = require('../trackers/trackers.service');

class ApplicationsService {
  async getAllApplications(orgId, filters = {}) {
    const conditions = [eq(schema.application.organisationId, orgId)];

    if (filters.jobPostingId) conditions.push(eq(schema.application.jobPostingId, filters.jobPostingId));
    if (filters.candidateId) conditions.push(eq(schema.application.candidateId, filters.candidateId));

    const rows = await db.select().from(schema.application).where(and(...conditions));
    return this._enrichApplications(rows);
  }

  /**
   * Status/current-stage no longer live on application — they're read
   * from the linked tracker, same "resolve IDs server-side" principle as
   * before, just pointed at a different table now.
   */
  async _enrichApplications(rows) {
    if (rows.length === 0) return [];

    const trackerIds = rows.map((r) => r.trackerId);
    const trackers = await db.select({ id: schema.candidateTracker.id, status: schema.candidateTracker.status })
      .from(schema.candidateTracker)
      .where(inArray(schema.candidateTracker.id, trackerIds));

    const trackerById = new Map(trackers.map((t) => [t.id, t]));

    return rows.map((app) => ({
      ...app,
      trackerStatus: trackerById.get(app.trackerId)?.status || null,
    }));
  }

  async getApplicationById(orgId, id) {
    const app = await db.query.application.findFirst({
      where: and(eq(schema.application.id, id), eq(schema.application.organisationId, orgId)),
    });

    if (!app) throw new NotFoundError('Application not found');

    const tracker = await trackersService.getTrackerById(orgId, app.trackerId);

    return { ...app, tracker };
  }

  /**
   * Creates the application row and its dedicated candidate_tracker
   * together, in one transaction — see ADR-1. The tracker's
   * workflowTemplateId and openPositionId are pulled from the job
   * posting, not passed in by the caller, so a posting's own template
   * (or requisition link) is always honored automatically.
   */
  async createApplication(orgId, data, userId) {
    return await db.transaction(async (tx) => {
      const job = await tx.query.jobPosting.findFirst({
        where: and(eq(schema.jobPosting.id, data.jobPostingId), eq(schema.jobPosting.organisationId, orgId)),
      });

      if (!job) throw new NotFoundError('Job posting not found');

      const workflowTemplateId = job.workflowTemplateId
        || await trackersService.resolveWorkflowTemplateId(orgId, job.teamId, userId);

      const tracker = await trackersService.createTrackerTx(tx, orgId, {
        teamId: job.teamId,
        candidateId: data.candidateId,
        openPositionId: job.openPositionId,
        workflowTemplateId,
      }, userId);

      const [newApplication] = await tx.insert(schema.application).values({
        organisationId: orgId,
        candidateId: data.candidateId,
        jobPostingId: job.id,
        trackerId: tracker.id,
        entrySource: data.entrySource || 'job_post',
      }).returning();

      await emitEvent(orgId, userId, 'application.created', 'application', newApplication.id, newApplication, 'pipeline');
      await auditWrite(orgId, userId, 'create', 'application', newApplication.id, null, newApplication, 'pipeline');

      return { ...newApplication, tracker };
    });
  }
}

module.exports = new ApplicationsService();
