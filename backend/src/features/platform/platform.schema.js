const { z } = require('zod');

const listOrgsSchema = z.object({
  query: z.object({
    search: z.string().trim().optional(),
    status: z.enum(['trialing', 'active', 'suspended', 'cancelled']).optional(),
    planSlug: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  }),
});

const orgIdSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid organisation ID') }),
});

module.exports = { listOrgsSchema, orgIdSchema };
