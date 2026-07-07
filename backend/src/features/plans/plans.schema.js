const { z } = require('zod');

const createPlanSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    slug: z.string().min(1, 'Slug is required'),
    description: z.string().optional(),
    priceMonthly: z.string().optional(),
    priceYearly: z.string().optional(),
    modules: z.array(z.string()).default([]),
    limits: z.record(z.any()).optional(),
    creditAllowance: z.number().optional(),
    creditsEnabled: z.boolean().optional(),
    trialDays: z.number().optional()
  })
});

const updatePlanSchema = z.object({
  body: createPlanSchema.shape.body.partial(),
  params: z.object({
    id: z.string().uuid('Invalid plan ID')
  })
});

const getPlanParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid plan ID')
  })
});

module.exports = {
  createPlanSchema,
  updatePlanSchema,
  getPlanParamsSchema
};
