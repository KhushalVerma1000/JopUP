const { z } = require('zod');

const stageKey = z.string().trim().min(1).max(60);
const idParams = z.object({ params: z.object({ id: z.string().uuid('Invalid rule ID') }) });

const createRuleSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(100),
    trigger: z.enum(['date_set', 'mail_sent']),
    triggerKey: z.string().trim().min(1).max(60),
    targetStageKey: stageKey,
    isEnabled: z.boolean().optional(),
  }),
});

const updateRuleSchema = z.object({
  params: idParams.shape.params,
  body: z.object({
    name: z.string().trim().min(1).max(100).optional(),
    targetStageKey: stageKey.optional(),
    isEnabled: z.boolean().optional(),
  }).refine((b) => Object.keys(b).length > 0, 'Nothing to change'),
});

module.exports = { createRuleSchema, updateRuleSchema, ruleParamsSchema: idParams };
