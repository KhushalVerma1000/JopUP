const { z } = require('zod');

const createJobPostingSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Title is required'),
    description: z.string().min(1, 'Description is required'),
    teamId: z.string().uuid('Invalid team ID'),
    clientId: z.string().uuid('Invalid client ID').optional(),
    workflowTemplateId: z.string().uuid('Invalid template ID').optional(),
    requirements: z.string().optional(),
    benefits: z.string().optional(),
    location: z.string().optional(),
    workMode: z.enum(['onsite', 'remote', 'hybrid']).optional(),
    employmentType: z.enum(['full_time', 'part_time', 'contract', 'temporary', 'internship']).optional(),
    salaryMin: z.number().optional(),
    salaryMax: z.number().optional(),
    salaryCurrency: z.string().optional(),
    requiredSkills: z.array(z.string()).optional(),
    vacancies: z.number().int().min(1).optional()
  })
});

const updateJobPostingSchema = z.object({
  body: createJobPostingSchema.shape.body.partial().extend({
    status: z.enum(['draft', 'published', 'paused', 'closed', 'archived']).optional()
  }),
  params: z.object({
    id: z.string().uuid('Invalid job posting ID')
  })
});

const jobPostingParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid job posting ID')
  })
});

module.exports = {
  createJobPostingSchema,
  updateJobPostingSchema,
  jobPostingParamsSchema
};
