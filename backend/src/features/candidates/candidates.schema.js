const { z } = require('zod');

const createCandidateSchema = z.object({
  body: z.object({
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    ownerTeamId: z.string().uuid('Invalid team ID'),
    email: z.string().email('Invalid email').optional(),
    phone: z.string().optional(),
    location: z.string().optional(),
    linkedinUrl: z.string().url('Invalid URL').optional(),
    source: z.enum(['job_post', 'manual', 'resume_upload', 'referral', 'agency', 'linkedin', 'other']),
    sourceRef: z.string().optional(),
    resumeUrl: z.string().url('Invalid URL').optional(),
    skills: z.array(z.string()).optional(),
    notes: z.string().optional(),
    customFields: z.record(z.any()).optional()
  })
});

const updateCandidateSchema = z.object({
  body: createCandidateSchema.shape.body.partial().extend({
    status: z.enum(['active', 'placed', 'blacklisted', 'archived']).optional()
  }),
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
