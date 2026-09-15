const express = require('express');
const router = express.Router();
const controller = require('./users.controller');
const validate = require('../../middlewares/validate');
const schema = require('./users.schema');
const { requireAuth, requireOrgRole } = require('../../middlewares/requireAuth');
const { ForbiddenError } = require('../../utils/errors');

router.use(requireAuth);

// Editing a profile is allowed for the user themself, or for an org_admin
// editing anyone in the org. There's no seeded permission key that captures
// "self OR org_admin", so this is a small inline check rather than
// requirePermission — same precedent as auth.service.js's _isEligibleApprover
// doing role logic in code where a single fixed permission key doesn't fit.
function requireSelfOrOrgAdmin(req, res, next) {
  const isSelf = req.user?.userId === req.params.id;
  const isOrgAdmin = (req.user?.roles || []).some(
    (r) => r.roleName === 'org_admin' && (r.teamId === null || r.teamId === undefined)
  );
  if (!isSelf && !isOrgAdmin) {
    return next(new ForbiddenError('You can only edit your own profile'));
  }
  next();
}

// Employee directory — open to any authenticated staff member of the org,
// same precedent as teams.routes.js's plain GET. Every workbench (employee,
// client, manager) needs this to populate "assigned to" / "owner" pickers.
router.get('/', validate(schema.listUsersQuerySchema), controller.list.bind(controller));
router.get('/:id', validate(schema.userParamsSchema), controller.getById.bind(controller));

router.patch(
  '/:id',
  requireSelfOrOrgAdmin,
  validate(schema.updateUserSchema),
  controller.update.bind(controller)
);

// Status changes (deactivate/suspend/reactivate) and removal are org_admin
// only — never self-service, and never open to manager/hr.
router.patch(
  '/:id/status',
  requireOrgRole('org_admin'),
  validate(schema.updateUserStatusSchema),
  controller.updateStatus.bind(controller)
);
router.delete(
  '/:id',
  requireOrgRole('org_admin'),
  validate(schema.userParamsSchema),
  controller.remove.bind(controller)
);

module.exports = router;
