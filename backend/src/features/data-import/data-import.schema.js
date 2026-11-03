const { z } = require('zod');

const uuid = z.string().uuid();
const key = z.string().min(1).max(300);
// null clears an earlier answer
const entry = (shape) => z.union([z.null(), shape]);

const decisionsPatch = z.object({
  clients: z.record(key, entry(z.object({ action: z.enum(['use_existing', 'create']), clientId: uuid.optional() }))).optional(),
  locations: z.record(key, entry(z.object({ action: z.enum(['use_existing', 'create']), locationId: uuid.optional() }))).optional(),
  positions: z.record(key, entry(z.object({ action: z.enum(['use_existing', 'create', 'none']), positionId: uuid.optional() }))).optional(),
  recruiters: z.record(key, entry(z.object({ userId: uuid.nullable() }))).optional(),
  candidates: z.record(key, entry(z.object({ action: z.enum(['create', 'use_existing', 'fill_empty', 'skip']) }))).optional(),
  rows: z.record(key, entry(z.object({ action: z.enum(['skip', 'include']) }))).optional(),
}).strict();

const batchParamsSchema = z.object({ params: z.object({ id: uuid }) });
const decisionsSchema = z.object({ params: z.object({ id: uuid }), body: decisionsPatch });
const rowsSchema = z.object({
  params: z.object({ id: uuid }),
  query: z.object({
    filter: z.enum(['all', 'issues', 'errors', 'blocked', 'skipped', 'existing']).optional(),
    page: z.coerce.number().int().min(1).max(10000).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  }),
});

module.exports = { batchParamsSchema, decisionsSchema, rowsSchema };
