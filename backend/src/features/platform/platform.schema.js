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

const grantTrialSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid organisation ID') }),
  body: z.object({ from: z.enum(['signup', 'today']).default('signup') }).default({ from: 'signup' }),
});

const addSelectionSchema = z.object({
  body: z.object({
    match: z.string().trim().min(3, 'Enter an email or a company domain').max(200),
    note: z.string().trim().max(200).optional(),
  }),
});

const selectionIdSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid ID') }),
});

const listRequestsSchema = z.object({
  query: z.object({ status: z.enum(['pending', 'approved', 'declined', 'contacted', 'all']).default('pending') }),
});

const requestIdSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid request ID') }),
  body: z.object({ note: z.string().trim().max(300).optional() }).default({}),
});

const approveRequestSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid request ID') }),
  body: z.object({
    days: z.coerce.number().int().min(7, 'At least 7 days').max(90, 'At most 90 days').default(30),
    organisationId: z.string().uuid('Invalid workspace ID').optional(),
    note: z.string().trim().max(300).optional(),
  }).default({ days: 30 }),
});

module.exports = { listOrgsSchema, orgIdSchema, grantTrialSchema, addSelectionSchema, selectionIdSchema, listRequestsSchema, requestIdSchema, approveRequestSchema };
