const express = require('express');
const router = express.Router();
const controller = require('./invitations.controller');
const validate = require('../../middlewares/validate');
const schema = require('./invitations.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');
const { registerLimiter } = require('../../middlewares/rateLimit');

// Public — the invitee redeems their token. Reuses the register rate limit
// (5/hour per IP) since this is functionally the same kind of action.
router.post('/accept', registerLimiter, validate(schema.acceptInvitationSchema), controller.accept.bind(controller));

// Everything else is org_admin only — 'invite' is an existing key on
// org_admin's 'users' permission (seed.ts), nobody else holds it.
router.use(requireAuth);
router.post('/', requirePermission('users', 'invite'), validate(schema.createInvitationSchema), controller.create.bind(controller));
router.get('/', requirePermission('users', 'invite'), validate(schema.listInvitationsSchema), controller.list.bind(controller));
router.post('/:id/revoke', requirePermission('users', 'invite'), validate(schema.invitationParamsSchema), controller.revoke.bind(controller));

module.exports = router;
