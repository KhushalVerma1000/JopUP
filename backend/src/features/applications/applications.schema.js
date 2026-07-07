const { z } = require('zod');

const createApplicationSchema = z.object({
  body: z.object({
    candidateId: z.string().uuid('Invalid candidate ID'),
    jobPostingId: z.string().uuid('Invalid job posting ID').optional(),
    teamId: z.string().uuid('Invalid team ID'),
    workflowTemplateId: z.string().uuid('Invalid template ID'),
    entrySource: z.string().optional(),
    notes: z.string().optional(),
    assignedHr: z.string().uuid('Invalid user ID').optional()
  })
});

const advanceStageSchema = z.object({
  body: z.object({
    nextStageId: z.string().uuid('Invalid stage ID')
  }),
  params: z.object({
    id: z.string().uuid('Invalid application ID')
  })
});

const blockApplicationSchema = z.object({
  body: z.object({
    reason: z.string().min(1, 'Reason is required')
  }),
  params: z.object({
    id: z.string().uuid('Invalid application ID')
  })
});

const addActionSchema = z.object({
  body: z.object({
    actionType: z.string().min(1, 'Action type is required'),
    content: z.string().optional(),
    metadata: z.record(z.any()).optional()
  }),
  params: z.object({
    id: z.string().uuid('Invalid application ID'),
    logId: z.string().uuid('Invalid log ID')
  })
});

const applicationParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid application ID')
  })
});

const stageLogParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid application ID'),
    logId: z.string().uuid('Invalid log ID')
  })
});

module.exports = {
  createApplicationSchema,
  advanceStageSchema,
  blockApplicationSchema,
  addActionSchema,
  applicationParamsSchema,
  stageLogParamsSchema
};
