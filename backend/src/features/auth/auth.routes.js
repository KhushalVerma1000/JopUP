const express = require('express');
const router = express.Router();
const controller = require('./auth.controller');
const validate = require('../../middlewares/validate');
const schema = require('./auth.schema');
const { requireAuth } = require('../../middlewares/requireAuth');

// Public — staff self-registration (creates a 'pending_approval' account)
router.post('/register', validate(schema.registerStaffSchema), controller.registerStaff.bind(controller));

// Public — staff login (rejects anything other than 'active' accounts)
router.post('/login', validate(schema.loginStaffSchema), controller.login.bind(controller));

// Manager / org_admin only — review self-registration requests.
// Authorization (org_admin vs. manager-of-this-team) is enforced in the service layer,
// since it depends on the *target* request's team, not a fixed permission key.
router.get(
  '/pending-approvals',
  requireAuth,
  validate(schema.listPendingApprovalsSchema),
  controller.listPendingApprovals.bind(controller)
);
router.post(
  '/pending-approvals/:userId/approve',
  requireAuth,
  validate(schema.approvalParamsSchema),
  controller.approve.bind(controller)
);
router.post(
  '/pending-approvals/:userId/reject',
  requireAuth,
  validate(schema.rejectStaffSchema),
  controller.reject.bind(controller)
);

module.exports = router;
