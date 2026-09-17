const { z } = require('zod');

const createPlanSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    slug: z.string().min(1, 'Slug is required'),
    description: z.string().optional(),
    priceMonthly: z.string().optional(),
    priceYearly: z.string().optional(),
    // No .default([]) here deliberately — updatePlanSchema below reuses this
    // via .partial(), and Zod's .partial() does NOT stop an inner
    // .default() from firing on an absent field (it only makes the field
    // optional; ZodDefault still substitutes its default for `undefined`).
    // That meant ANY partial update omitting `modules` silently wiped it to
    // [] — confirmed and reproduced against a live DB, and it's what broke
    // every module-gated route for every org whose plan got touched by an
    // unrelated PATCH. The DB column already has its own default
    // (`plan.modules` is `.notNull().default('[]'::jsonb)` in
    // schema/01-platform.ts), so create-time omission is still handled
    // correctly without a Zod-level default.
    modules: z.array(z.string()).optional(),
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
