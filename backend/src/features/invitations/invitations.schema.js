const { z } = require('zod');

// org_admin is intentionally NOT self-registerable (see auth.schema.js) —
// invitation is the only path to it, alongside the two team-scoped roles.
const INVITABLE_ROLES = ['org_admin', 'manager', 'hr'];

const createInvitationSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    roleName: z.enum(INVITABLE_ROLES, {
      errorMap: () => ({ message: `roleName must be one of: ${INVITABLE_ROLES.join(', ')}` }),
    }),
    // Required for team-scoped roles (manager/hr), must be omitted/null for org_admin.
    teamId: z.string().uuid('Invalid team ID').optional(),
  }),
});

const listInvitationsSchema = z.object({
  query: z.object({
    status: z.enum(['pending', 'accepted', 'expired', 'revoked']).optional(),
  }),
});

const invitationParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid invitation ID'),
  }),
});

const acceptInvitationSchema = z.object({
  body: z.object({
    token: z.string().min(1, 'Token is required'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    phone: z.string().optional(),
  }),
});

module.exports = {
  INVITABLE_ROLES,
  createInvitationSchema,
  listInvitationsSchema,
  invitationParamsSchema,
  acceptInvitationSchema,
};
