const { z } = require('zod');

const createOrganizationSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    slug: z.string().min(1, 'Slug is required'),
    planId: z.string().uuid('Invalid plan ID'),
    domain: z.string().optional(),
    timezone: z.string().optional()
  })
});

const updateOrganizationSchema = z.object({
  body: createOrganizationSchema.shape.body.partial().extend({
    logoUrl: z.string().optional(),
    status: z.enum(['active', 'suspended', 'trial', 'cancelled']).optional()
  }),
  params: z.object({
    id: z.string().uuid('Invalid organization ID')
  })
});

const getOrgParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid organization ID')
  })
});

module.exports = {
  createOrganizationSchema,
  updateOrganizationSchema,
  getOrgParamsSchema
};
