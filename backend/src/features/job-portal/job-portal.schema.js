const { z } = require('zod');

const portalSubmitApplicationSchema = z.object({
  body: z.object({
    jobPostingId: z.string().uuid('Invalid job posting ID'),
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    email: z.string().email('Invalid email'),
    phone: z.string().optional(),
    location: z.string().optional(),
    linkedinUrl: z.string().url().optional(),
    resumeUrl: z.string().url().optional(),
    coverLetter: z.string().optional()
  })
});

const getPortalJobParamsSchema = z.object({
  params: z.object({
    orgSlug: z.string().min(1, 'Org slug is required'),
    jobId: z.string().uuid('Invalid job ID')
  })
});

const getPortalOrgParamsSchema = z.object({
  params: z.object({
    orgSlug: z.string().min(1, 'Org slug is required')
  })
});

module.exports = {
  portalSubmitApplicationSchema,
  getPortalJobParamsSchema,
  getPortalOrgParamsSchema
};
