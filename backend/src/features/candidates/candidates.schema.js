const { z } = require('zod');

const candidateBodySchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  ownerTeamId: z.string().uuid('Invalid team ID'),
  email: z.string().email('Invalid email').optional(),
  phone: z.string().optional(),
  // ISO 3166-1 alpha-2 (e.g. "IN", "US", "GB") — required whenever phone
  // is given, since a raw number is ambiguous without it. See
  // 04-candidates.ts's phoneCountry note and ADR-2.
  phoneCountry: z.string().length(2, 'Use a 2-letter country code (e.g. "IN", "US")').optional(),
  location: z.string().optional(),
  linkedinUrl: z.string().url('Invalid URL').optional(),
  source: z.enum(['job_post', 'manual', 'resume_upload', 'referral', 'agency', 'linkedin', 'other']),
  sourceRef: z.string().optional(),
  resumeUrl: z.string().url('Invalid URL').optional(),
  skills: z.array(z.string()).optional(),
  notes: z.string().optional(),
  customFields: z.record(z.any()).optional(),
  // Set true to proceed after a PossibleDuplicateError was already shown
  // to the user once and they chose "create anyway".
  confirmDuplicate: z.boolean().optional(),
});

const requirePhoneCountry = (body) => !body.phone || Boolean(body.phoneCountry);
const phoneCountryRefinement = {
  message: 'phoneCountry is required when phone is provided',
  path: ['phoneCountry'],
};

const createCandidateSchema = z.object({
  body: candidateBodySchema.refine(requirePhoneCountry, phoneCountryRefinement),
});

const updateCandidateSchema = z.object({
  body: candidateBodySchema.partial().extend({
    status: z.enum(['active', 'placed', 'blacklisted', 'archived']).optional()
  }).refine(requirePhoneCountry, phoneCountryRefinement),
  params: z.object({
    id: z.string().uuid('Invalid candidate ID')
  })
});

const getCandidateParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid candidate ID')
  })
});

const grantAccessSchema = z.object({
  body: z.object({
    teamId: z.string().uuid('Invalid team ID'),
    canWrite: z.boolean().default(false)
  }),
  params: z.object({
    id: z.string().uuid('Invalid candidate ID')
  })
});

module.exports = {
  createCandidateSchema,
  updateCandidateSchema,
  getCandidateParamsSchema,
  grantAccessSchema
};
