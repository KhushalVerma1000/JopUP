const { z } = require('zod');

const createTemplateSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    teamId: z.string().uuid('Invalid team ID'),
    description: z.string().optional()
  })
});

const updateTemplateSchema = z.object({
  body: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    isDefault: z.boolean().optional()
  }),
  params: z.object({
    id: z.string().uuid('Invalid template ID')
  })
});

const templateParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid template ID')
  })
});

const createStageSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    stageKey: z.string().min(1, 'Stage key is required'),
    description: z.string().optional(),
    orderIndex: z.number().int(),
    isBlockable: z.boolean().optional(),
    requiresApproval: z.boolean().optional(),
    isFinalSuccess: z.boolean().optional()
  }),
  params: z.object({
    templateId: z.string().uuid('Invalid template ID')
  })
});

const stageParamsSchema = z.object({
  params: z.object({
    templateId: z.string().uuid('Invalid template ID'),
    stageId: z.string().uuid('Invalid stage ID')
  })
});

module.exports = {
  createTemplateSchema,
  updateTemplateSchema,
  templateParamsSchema,
  createStageSchema,
  stageParamsSchema
};
