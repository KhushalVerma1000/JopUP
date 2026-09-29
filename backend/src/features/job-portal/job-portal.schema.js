const { z } = require('zod');

const portalSubmitApplicationSchema = z.object({
  body: z.object({
    jobPostingId: z.string().uuid('Invalid job posting ID'),
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    email: z.string().email('Invalid email'),
    phone: z.string().optional(),
    // ISO 3166-1 alpha-2 — required alongside phone (see 04-candidates.ts /
    // ADR-2). A public applicant could be based anywhere, so this platform
    // never guesses their country from the org's own location.
    phoneCountry: z.string().length(2, 'Use a 2-letter country code (e.g. "IN", "US")').optional(),
    location: z.string().optional(),
    linkedinUrl: z.string().url().optional(),
    resumeUrl: z.string().url().optional(),
    coverLetter: z.string().optional()
  }).refine((body) => !body.phone || Boolean(body.phoneCountry), {
    message: 'phoneCountry is required when phone is provided',
    path: ['phoneCountry'],
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
