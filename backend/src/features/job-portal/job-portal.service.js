const { db, schema } = require('../../utils/db');
const { eq, and } = require('drizzle-orm');
const { NotFoundError, BadRequestError } = require('../../utils/errors');
const candidatesService = require('../candidates/candidates.service');
const applicationsService = require('../applications/applications.service');

class JobPortalService {
  async getOrgBySlug(slug) {
    const org = await db.query.organisation.findFirst({
      where: eq(schema.organisation.slug, slug)
    });
    
    if (!org) throw new NotFoundError('Organization not found');
    
    return org;
  }

  async getPublicJobs(orgId) {
    return await db.select()
      .from(schema.jobPosting)
      .where(and(
        eq(schema.jobPosting.organisationId, orgId),
        eq(schema.jobPosting.status, 'published')
      ));
  }

  async getPublicJobDetails(orgId, jobId) {
    const job = await db.query.jobPosting.findFirst({
      where: and(
        eq(schema.jobPosting.id, jobId),
        eq(schema.jobPosting.organisationId, orgId),
        eq(schema.jobPosting.status, 'published')
      )
    });
    
    if (!job) throw new NotFoundError('Job posting not found or not active');
    
    return job;
  }

  async submitApplication(orgId, data) {
    return await db.transaction(async (tx) => {
      const job = await this.getPublicJobDetails(orgId, data.jobPostingId);
      
      if (!job.workflowTemplateId) {
        throw new BadRequestError('This job posting is not configured to receive applications properly.');
      }
      
      // 1. Create Candidate Profile
      // Check if candidate with this email exists in org
      let candidate = await tx.query.candidate.findFirst({
        where: and(
          eq(schema.candidate.email, data.email),
          eq(schema.candidate.organisationId, orgId)
        )
      });
      
      if (!candidate) {
        // Create new candidate
        [candidate] = await tx.insert(schema.candidate).values({
          organisationId: orgId,
          ownerTeamId: job.teamId,
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: data.phone,
          location: data.location,
          linkedinUrl: data.linkedinUrl,
          resumeUrl: data.resumeUrl,
          source: 'job_post',
          sourceRef: job.id,
          status: 'active'
        }).returning();
      } else {
        // Update candidate with new info if needed
        [candidate] = await tx.update(schema.candidate)
          .set({ 
            resumeUrl: data.resumeUrl || candidate.resumeUrl,
            phone: data.phone || candidate.phone,
            linkedinUrl: data.linkedinUrl || candidate.linkedinUrl,
            updatedAt: new Date()
          })
          .where(eq(schema.candidate.id, candidate.id))
          .returning();
      }
      
      // 2. Create Application
      // Use applicationsService logic for consistency, or reproduce minimal here
      const [newApp] = await tx.insert(schema.application).values({
        organisationId: orgId,
        teamId: job.teamId,
        jobPostingId: job.id,
        candidateId: candidate.id,
        workflowTemplateId: job.workflowTemplateId,
        entrySource: 'career_portal',
        notes: data.coverLetter ? `Cover Letter:\n${data.coverLetter}` : null,
        status: 'active'
      }).returning();
      
      // 3. Set first stage
      const firstStage = await tx.query.workflowStage.findFirst({
        where: eq(schema.workflowStage.workflowTemplateId, job.workflowTemplateId),
        orderBy: (stages, { asc }) => [asc(stages.orderIndex)]
      });
      
      if (firstStage) {
        await tx.insert(schema.applicationStageLog).values({
          applicationId: newApp.id,
          stageId: firstStage.id,
          status: 'active'
        });
      }
      
      return { application: newApp, candidate };
    });
  }
}

module.exports = new JobPortalService();
