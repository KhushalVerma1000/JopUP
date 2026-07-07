const { db, schema } = require('../../utils/db');
const { eq, and, asc } = require('drizzle-orm');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { NotFoundError, BadRequestError, ConflictError } = require('../../utils/errors');
const { emitEvent } = require('../../utils/events');

const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-here';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

class PortalService {
  /**
   * Get all published job postings.
   */
  async getPublicJobPostings() {
    return db
      .select()
      .from(schema.jobPosting)
      .where(eq(schema.jobPosting.status, 'published'));
  }

  /**
   * Get a single published job posting by ID.
   */
  async getPublicJobPostingById(id) {
    const posting = await db.query.jobPosting.findFirst({
      where: and(
        eq(schema.jobPosting.id, id),
        eq(schema.jobPosting.status, 'published')
      ),
    });

    if (!posting) {
      throw new NotFoundError(`Job posting with id '${id}' not found`);
    }

    return posting;
  }

  /**
   * Register a new job seeker.
   */
  async registerJobSeeker(data) {
    // Check if email already registered
    const existing = await db.query.jobSeeker.findFirst({
      where: eq(schema.jobSeeker.email, data.email),
    });

    if (existing) {
      throw new ConflictError('Email is already registered');
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    const [seeker] = await db
      .insert(schema.jobSeeker)
      .values({
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone || null,
        location: data.location || null,
        resumeUrl: data.resumeUrl || null,
        linkedinUrl: data.linkedinUrl || null,
        skills: data.skills || [],
        status: 'active',
      })
      .returning();

    // Remove password hash from response
    delete seeker.passwordHash;
    return seeker;
  }

  /**
   * Login a job seeker.
   */
  async loginJobSeeker(email, password) {
    const seeker = await db.query.jobSeeker.findFirst({
      where: eq(schema.jobSeeker.email, email),
    });

    if (!seeker || seeker.status !== 'active') {
      throw new BadRequestError('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(password, seeker.passwordHash);
    if (!isMatch) {
      throw new BadRequestError('Invalid email or password');
    }

    const token = jwt.sign(
      { id: seeker.id, email: seeker.email, role: 'job_seeker' },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    delete seeker.passwordHash;
    return { seeker, token };
  }

  /**
   * Submit a job application.
   */
  async submitPortalApplication(jobSeekerId, data) {
    // 1. Get job posting to verify it is published and resolve organisationId
    const posting = await db.query.jobPosting.findFirst({
      where: and(
        eq(schema.jobPosting.id, data.jobPostingId),
        eq(schema.jobPosting.status, 'published')
      ),
    });

    if (!posting) {
      throw new NotFoundError(`Published job posting with id '${data.jobPostingId}' not found`);
    }

    // Check for duplicate application
    const existingApp = await db.query.portalApplication.findFirst({
      where: and(
        eq(schema.portalApplication.jobPostingId, data.jobPostingId),
        eq(schema.portalApplication.jobSeekerId, jobSeekerId)
      ),
    });

    if (existingApp) {
      throw new ConflictError('You have already applied to this job posting');
    }

    const seeker = await db.query.jobSeeker.findFirst({
      where: eq(schema.jobSeeker.id, jobSeekerId),
    });

    const [portalApp] = await db
      .insert(schema.portalApplication)
      .values({
        jobPostingId: data.jobPostingId,
        jobSeekerId,
        coverLetter: data.coverLetter || null,
        resumeUrl: data.resumeUrl || seeker.resumeUrl || null,
        status: 'submitted',
      })
      .returning();

    // Emit event for transactional outbox
    await emitEvent(
      posting.organisationId,
      null, // actorId is null since public user is applying
      'portal_application.submitted',
      'portalApplication',
      portalApp.id,
      { portalApplicationId: portalApp.id, jobPostingId: posting.id, email: seeker.email },
      'job_portal'
    );

    // Call processing worker synchronously to make candidate immediately visible
    try {
      await this.processPortalApplication(portalApp.id);
    } catch (err) {
      console.error('[PortalService] Synchronous processing failed:', err.message);
    }

    return portalApp;
  }

  /**
   * Process a portal application (Candidate DB sync / Pipeline insertion).
   */
  async processPortalApplication(portalAppId) {
    const portalApp = await db.query.portalApplication.findFirst({
      where: eq(schema.portalApplication.id, portalAppId),
    });

    if (!portalApp || portalApp.status !== 'submitted') {
      return;
    }

    // Update status to processing
    await db
      .update(schema.portalApplication)
      .set({ status: 'processing' })
      .where(eq(schema.portalApplication.id, portalAppId));

    try {
      const seeker = await db.query.jobSeeker.findFirst({
        where: eq(schema.jobSeeker.id, portalApp.jobSeekerId),
      });

      const posting = await db.query.jobPosting.findFirst({
        where: eq(schema.jobPosting.id, portalApp.jobPostingId),
      });

      if (!seeker || !posting) {
        throw new Error('Associated seeker or posting not found');
      }

      const orgId = posting.organisationId;

      // 1. Find or create candidate in org by email
      let candidate = await db.query.candidate.findFirst({
        where: and(
          eq(schema.candidate.email, seeker.email),
          eq(schema.candidate.organisationId, orgId)
        ),
      });

      if (!candidate) {
        [candidate] = await db
          .insert(schema.candidate)
          .values({
            organisationId: orgId,
            ownerTeamId: posting.teamId,
            createdBy: posting.createdBy, // link to the posting creator as actor
            firstName: seeker.firstName,
            lastName: seeker.lastName,
            email: seeker.email,
            phone: seeker.phone || null,
            location: seeker.location || null,
            linkedinUrl: seeker.linkedinUrl || null,
            resumeUrl: portalApp.resumeUrl || seeker.resumeUrl || null,
            skills: seeker.skills || [],
            source: 'job_post',
            sourceRef: posting.id,
          })
          .returning();
      }

      // 2. Check if application already exists
      const existingApp = await db.query.application.findFirst({
        where: and(
          eq(schema.application.jobPostingId, posting.id),
          eq(schema.application.candidateId, candidate.id),
          eq(schema.application.organisationId, orgId)
        ),
      });

      if (existingApp) {
        await db
          .update(schema.portalApplication)
          .set({ status: 'duplicate' })
          .where(eq(schema.portalApplication.id, portalAppId));
        return;
      }

      // 3. Resolve workflow template
      let templateId = posting.workflowTemplateId;
      if (!templateId) {
        const defaultTemplate = await db.query.workflowTemplate.findFirst({
          where: and(
            eq(schema.workflowTemplate.organisationId, orgId),
            eq(schema.workflowTemplate.teamId, posting.teamId),
            eq(schema.workflowTemplate.isDefault, true)
          ),
        });

        if (defaultTemplate) {
          templateId = defaultTemplate.id;
        } else {
          const firstTemplate = await db.query.workflowTemplate.findFirst({
            where: and(
              eq(schema.workflowTemplate.organisationId, orgId),
              eq(schema.workflowTemplate.teamId, posting.teamId)
            ),
          });
          if (!firstTemplate) {
            throw new Error(`No workflow template found for team '${posting.teamId}'`);
          }
          templateId = firstTemplate.id;
        }
      }

      // 4. Find first stage
      const firstStage = await db.query.workflowStage.findFirst({
        where: eq(schema.workflowStage.workflowTemplateId, templateId),
        orderBy: [asc(schema.workflowStage.orderIndex)],
      });

      if (!firstStage) {
        throw new Error(`Workflow template '${templateId}' has no stages`);
      }

      let appRow;
      await db.transaction(async (tx) => {
        // Create application
        [appRow] = await tx
          .insert(schema.application)
          .values({
            organisationId: orgId,
            teamId: posting.teamId,
            jobPostingId: posting.id,
            candidateId: candidate.id,
            workflowTemplateId: templateId,
            entrySource: 'job_post',
            status: 'active',
          })
          .returning();

        // Create first stage log
        await tx.insert(schema.applicationStageLog).values({
          applicationId: appRow.id,
          stageId: firstStage.id,
          movedBy: posting.createdBy,
          status: 'active',
          notes: 'Inbound application from Job Portal',
        });
      });

      // Update portal application
      await db
        .update(schema.portalApplication)
        .set({
          status: 'processed',
          processedCandidateId: candidate.id,
          processedApplicationId: appRow.id,
          processedAt: new Date(),
        })
        .where(eq(schema.portalApplication.id, portalAppId));

      await emitEvent(
        orgId,
        posting.createdBy,
        'application.created',
        'application',
        appRow.id,
        { applicationId: appRow.id, candidateId: candidate.id, jobPostingId: posting.id },
        'job_portal'
      );
    } catch (err) {
      await db
        .update(schema.portalApplication)
        .set({
          status: 'failed',
          processingError: err.message,
        })
        .where(eq(schema.portalApplication.id, portalAppId));
      throw err;
    }
  }
}

module.exports = new PortalService();
