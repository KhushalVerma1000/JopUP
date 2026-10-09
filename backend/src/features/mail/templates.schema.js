const { z } = require('zod');
const { isKnownKey } = require('./columns');

const column = z.object({
  key: z.string().refine(isKnownKey, 'Unknown column'),
  label: z.string().trim().max(40).optional(),
});

const columns = z.array(column).min(1, 'Pick at least one column').max(20)
  .refine((cols) => new Set(cols.map((c) => c.key)).size === cols.length, 'A column can only appear once');

const idParams = z.object({ params: z.object({ id: z.string().uuid('Invalid template ID') }) });

const createTemplateSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(80),
    // null / missing = shared by the whole organisation
    teamId: z.string().uuid().nullable().optional(),
    trackerType: z.enum(['interview_tracker', 'submission_tracker', 'offer_tracker', 'joining_tracker', 'status_tracker', 'custom']).default('custom'),
    columns,
    isDefault: z.boolean().default(false),
  }),
});

const updateTemplateSchema = z.object({
  params: idParams.shape.params,
  body: z.object({
    name: z.string().trim().min(1).max(80).optional(),
    trackerType: createTemplateSchema.shape.body.shape.trackerType.unwrap().optional(),
    columns: columns.optional(),
    isDefault: z.boolean().optional(),
  }).refine((b) => Object.keys(b).length > 0, 'Nothing to change'),
});

module.exports = { createTemplateSchema, updateTemplateSchema, templateParamsSchema: idParams };
