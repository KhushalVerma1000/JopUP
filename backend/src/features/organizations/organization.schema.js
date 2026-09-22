const { z } = require('zod');

const createOrganizationSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    slug: z.string().min(1, 'Slug is required'),
    planId: z.string().uuid('Invalid plan ID'),
    domain: z.string().optional(),
    timezone: z.string().optional(),
    // Optional — when all four are provided, the org's first org_admin user
    // is created in the same transaction (see organization.service.js for
    // why this exists: without it, a self-signed-up org has no way to ever
    // get an org_admin at all). Left optional/independent rather than a
    // cross-field .refine() so updateOrganizationSchema's
    // `createOrganizationSchema.shape.body.partial()` keeps working — the
    // "all four or none" rule is enforced in the service instead.
    adminEmail: z.string().email('Invalid admin email').optional(),
    adminPassword: z.string().min(8, 'Admin password must be at least 8 characters').optional(),
    adminFirstName: z.string().min(1).optional(),
    adminLastName: z.string().min(1).optional(),
    adminPhone: z.string().optional()
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

// For the two public-discovery routes below (slug -> {id,name,slug}, and
// slug -> team list for a signup dropdown). Deliberately just `slug`, no
// format constraint beyond non-empty — slugs are arbitrary strings chosen
// at signup, not UUIDs.
const slugParamSchema = z.object({
  params: z.object({
    slug: z.string().min(1, 'Slug is required')
  })
});

// Self-service update for an org_admin editing their own org (routed via
// /organizations/me). Deliberately excludes planId, slug, and status —
// those stay platform_admin-only via the existing /:id route, since they're
// billing/tenant-lifecycle concerns, not branding.
const updateOwnOrganizationSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    domain: z.string().optional(),
    logoUrl: z.string().optional(),
    timezone: z.string().optional()
  })
});

module.exports = {
  createOrganizationSchema,
  updateOrganizationSchema,
  getOrgParamsSchema,
  slugParamSchema,
  updateOwnOrganizationSchema
};
