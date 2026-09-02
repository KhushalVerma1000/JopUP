const { z } = require('zod');

// Self-registration is intentionally limited to team-scoped roles.
// org_admin / platform_admin accounts are created via the invitation
// flow (src/schema/02-identity.ts: invitation table), never self-serve.
const SELF_REGISTERABLE_ROLES = ['hr', 'manager'];

const registerStaffSchema = z.object({
  body: z.object({
    organisationId: z.string().uuid('Invalid organisation ID'),
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    phone: z.string().optional(),
    teamId: z.string().uuid('Invalid team ID'),
    requestedRoleName: z.enum(SELF_REGISTERABLE_ROLES, {
      errorMap: () => ({ message: `requestedRoleName must be one of: ${SELF_REGISTERABLE_ROLES.join(', ')}` }),
    }),
    // Optional: name a specific manager to review the request. If omitted,
    // the request is visible to any org_admin or manager of the chosen team.
    requestedManagerId: z.string().uuid('Invalid manager ID').optional(),
  }),
});

const loginStaffSchema = z.object({
  body: z.object({
    organisationSlug: z.string().min(1, 'Organisation slug is required'),
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
  }),
});

const listPendingApprovalsSchema = z.object({
  query: z.object({
    teamId: z.string().uuid('Invalid team ID').optional(),
  }),
});

const approvalParamsSchema = z.object({
  params: z.object({
    userId: z.string().uuid('Invalid user ID'),
  }),
});

const rejectStaffSchema = z.object({
  params: z.object({
    userId: z.string().uuid('Invalid user ID'),
  }),
  body: z.object({
    reason: z.string().min(1, 'Rejection reason is required').optional(),
  }),
});

module.exports = {
  SELF_REGISTERABLE_ROLES,
  registerStaffSchema,
  loginStaffSchema,
  listPendingApprovalsSchema,
  approvalParamsSchema,
  rejectStaffSchema,
};
