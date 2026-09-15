const { z } = require('zod');

const USER_STATUSES = ['active', 'inactive', 'invited', 'pending_approval', 'rejected', 'suspended'];

const listUsersQuerySchema = z.object({
  query: z.object({
    teamId: z.string().uuid('Invalid team ID').optional(),
    status: z.enum(USER_STATUSES).optional(),
  }),
});

const userParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid user ID'),
  }),
});

// Profile fields only — role/team assignment goes through invitations
// (org_admin/manager/hr) or auth approval (initial team+role), and status
// changes go through the dedicated /:id/status endpoint below, so that
// each has its own permission check instead of one endpoint silently
// accepting whichever fields the caller happens to send.
const updateUserSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid user ID'),
  }),
  body: z.object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    phone: z.string().optional(),
    avatarUrl: z.string().url('Invalid URL').optional(),
  }),
});

const updateUserStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid user ID'),
  }),
  body: z.object({
    // Deliberately excludes 'invited'/'pending_approval'/'rejected' — those
    // are lifecycle states set by the invitation/approval flows themselves,
    // not something an admin should be able to jump a user into directly.
    status: z.enum(['active', 'inactive', 'suspended']),
  }),
});

module.exports = {
  USER_STATUSES,
  listUsersQuerySchema,
  userParamsSchema,
  updateUserSchema,
  updateUserStatusSchema,
};
