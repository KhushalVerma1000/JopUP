const { db, schema } = require('../../utils/db');
const { eq, and } = require('drizzle-orm');
const { NotFoundError } = require('../../utils/errors');
const { emitEvent } = require('../../utils/events');
const { auditWrite } = require('../../utils/audit');

class JobPostingsService {
  async getAllJobPostings(orgId, filters = {}) {
    const conditions = [eq(schema.jobPosting.organisationId, orgId)];
    
    if (filters.status) conditions.push(eq(schema.jobPosting.status, filters.status));
    if (filters.teamId) conditions.push(eq(schema.jobPosting.teamId, filters.teamId));
    
    return await db.select().from(schema.jobPosting).where(and(...conditions));
  }

  async getJobPostingById(orgId, id) {
    const j = await db.query.jobPosting.findFirst({
      where: and(eq(schema.jobPosting.id, id), eq(schema.jobPosting.organisationId, orgId))
    });
    
    if (!j) throw new NotFoundError('Job posting not found');
    
    return j;
  }

  async createJobPosting(orgId, data, userId) {
    const [newJob] = await db.insert(schema.jobPosting).values({
      ...data,
      organisationId: orgId,
      createdBy: userId,
      status: 'draft'
    }).returning();
    
    await auditWrite(orgId, userId, 'create', 'job_posting', newJob.id, null, newJob, 'job_postings');
    
    return newJob;
  }

  async updateJobPosting(orgId, id, data, userId) {
    const oldJob = await this.getJobPostingById(orgId, id);
    
    const [updatedJob] = await db
      .update(schema.jobPosting)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(schema.jobPosting.id, id), eq(schema.jobPosting.organisationId, orgId)))
      .returning();
      
    await auditWrite(orgId, userId, 'update', 'job_posting', id, oldJob, updatedJob, 'job_postings');
    
    return updatedJob;
  }

  async publishJobPosting(orgId, id, userId) {
    const oldJob = await this.getJobPostingById(orgId, id);
    
    const [publishedJob] = await db
      .update(schema.jobPosting)
      .set({ 
        status: 'published', 
        publishedAt: new Date(), 
        updatedAt: new Date() 
      })
      .where(and(eq(schema.jobPosting.id, id), eq(schema.jobPosting.organisationId, orgId)))
      .returning();
      
    await emitEvent(orgId, userId, 'job_posting.published', 'job_posting', id, publishedJob, 'job_postings');
    await auditWrite(orgId, userId, 'publish', 'job_posting', id, oldJob, publishedJob, 'job_postings');
    
    return publishedJob;
  }

  async closeJobPosting(orgId, id, userId) {
    const oldJob = await this.getJobPostingById(orgId, id);
    
    const [closedJob] = await db
      .update(schema.jobPosting)
      .set({ 
        status: 'closed', 
        closesAt: new Date(), 
        updatedAt: new Date() 
      })
      .where(and(eq(schema.jobPosting.id, id), eq(schema.jobPosting.organisationId, orgId)))
      .returning();
      
    await auditWrite(orgId, userId, 'close', 'job_posting', id, oldJob, closedJob, 'job_postings');
    
    return closedJob;
  }

  async deleteJobPosting(orgId, id) {
    const oldJob = await this.getJobPostingById(orgId, id);
    
    await db
      .delete(schema.jobPosting)
      .where(and(eq(schema.jobPosting.id, id), eq(schema.jobPosting.organisationId, orgId)));
      
    await auditWrite(orgId, null, 'delete', 'job_posting', id, oldJob, null, 'job_postings');
  }
}

module.exports = new JobPostingsService();
