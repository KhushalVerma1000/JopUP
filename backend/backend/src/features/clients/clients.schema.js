const { z } = require('zod');

const createClientSchema = z.object({
  body: z.object({
    companyName: z.string().min(1, 'Company name is required'),
    ownerTeamId: z.string().uuid('Invalid team ID'),
    industry: z.string().optional(),
    website: z.string().optional(),
    contactName: z.string().optional(),
    contactEmail: z.string().email('Invalid email').optional(),
    contactPhone: z.string().optional(),
    contactRole: z.string().optional(),
    address: z.object({
      line1: z.string().optional(),
      line2: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      country: z.string().optional(),
      postcode: z.string().optional()
    }).optional(),
    notes: z.string().optional(),
    // No .default(false) here deliberately — same bug as
    // plans.schema.js's `modules` field (see its comment for the full
    // explanation): updateClientSchema below reuses this via .partial(),
    // which does not stop an inner .default() from firing on an absent
    // field. That meant any PATCH to a client omitting sharedOrgWide
    // silently reset it to false — teams that were supposed to see an
    // org-wide-shared client would silently lose access on the next
    // unrelated edit (e.g. just updating `notes`). The DB column already
    // defaults to false (schema/03-clients.ts), so create-time omission is
    // still handled correctly without a Zod-level default.
    sharedOrgWide: z.boolean().optional(),
    customFields: z.record(z.any()).optional()
  })
});

const updateClientSchema = z.object({
  body: createClientSchema.shape.body.partial().extend({
    status: z.enum(['active', 'inactive', 'prospect', 'on_hold']).optional()
  }),
  params: z.object({
    id: z.string().uuid('Invalid client ID')
  })
});

const getClientParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid client ID')
  })
});

const shareClientSchema = z.object({
  body: z.object({
    teamId: z.string().uuid('Invalid team ID'),
    canWrite: z.boolean().default(false)
  }),
  params: z.object({
    id: z.string().uuid('Invalid client ID')
  })
});

module.exports = {
  createClientSchema,
  updateClientSchema,
  getClientParamsSchema,
  shareClientSchema
};
