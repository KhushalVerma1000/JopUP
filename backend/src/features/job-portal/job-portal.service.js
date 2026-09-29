const { db, schema } = require('../../utils/db');
const { eq, and } = require('drizzle-orm');
const { NotFoundError, BadRequestError } = require('../../utils/errors');
const trackersService = require('../trackers/trackers.service');
const { normalizePhone } = require('../../utils/phone');

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

  /**
   * ADR-1: creates application + its dedicated candidate_tracker together,
   * via the same trackersService.createTrackerTx path applications.service
   * uses internally — a guest portal apply is created exactly the same
   * way as an internal one, one engine regardless of entry route.
   *
   * Candidate lookup here is still by email (not phone) — the portal's
   * natural identity for a returning applicant is the email they log in
   * with, not their phone. phone/phoneCountry are still normalized and
   * stored (ADR-2 / global phone handling) so this candidate is caught by
   * later phone-based dedup if HR looks them up from the internal side.
   */
  async submitApplication(orgId, data) {
    const job = await this.getPublicJobDetails(orgId, data.jobPostingId);

    if (!job.workflowTemplateId) {
      throw new BadRequestError('This job posting is not configured to receive applications properly.');
    }

    return await db.transaction(async (tx) => {
      // 1. Create or update Candidate Profile
      let candidate = await tx.query.candidate.findFirst({
        where: and(
          eq(schema.candidate.email, data.email),
          eq(schema.candidate.organisationId, orgId)
        )
      });

      const phoneNormalized = normalizePhone(data.phone, data.phoneCountry);

      if (!candidate) {
        [candidate] = await tx.insert(schema.candidate).values({
          organisationId: orgId,
          ownerTeamId: job.teamId,
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: data.phone,
          phoneCountry: data.phoneCountry,
          phoneNormalized,
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
            phoneCountry: data.phoneCountry || candidate.phoneCountry,
            phoneNormalized: phoneNormalized || candidate.phoneNormalized,
            linkedinUrl: data.linkedinUrl || candidate.linkedinUrl,
            updatedAt: new Date()
          })
          .where(eq(schema.candidate.id, candidate.id))
          .returning();
      }

      // 2. Create the candidate_tracker (stage/status engine) — no
      // anonymous actor, so assignedHr/movedBy stay null (both nullable).
      const tracker = await trackersService.createTrackerTx(tx, orgId, {
        teamId: job.teamId,
        candidateId: candidate.id,
        openPositionId: job.openPositionId,
        workflowTemplateId: job.workflowTemplateId,
        notes: data.coverLetter ? `Cover Letter:\n${data.coverLetter}` : undefined,
      }, null);

      // 3. Create the application record (pure metadata — see ADR-1)
      const [newApp] = await tx.insert(schema.application).values({
        organisationId: orgId,
        candidateId: candidate.id,
        jobPostingId: job.id,
        trackerId: tracker.id,
        entrySource: 'career_portal',
      }).returning();

      return { application: newApp, candidate, tracker };
    });
  }
}

module.exports = new JobPortalService();
