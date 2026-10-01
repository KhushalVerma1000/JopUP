const express = require('express');
const router = express.Router();
const controller = require('./platform.controller');
const validate = require('../../middlewares/validate');
const schema = require('./platform.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');

// Platform-console read APIs. Gated by the same 'organisations:read' key that
// platform_owner and platform_admin already hold (and org_admin / manager / hr
// do not), so no new permission needs seeding.
router.use(requireAuth, requirePermission('organisations', 'read'));

router.get('/metrics', controller.metrics.bind(controller));
router.get('/organizations', validate(schema.listOrgsSchema), controller.listOrganisations.bind(controller));
router.get('/organizations/:id', validate(schema.orgIdSchema), controller.getOrganisation.bind(controller));

module.exports = router;
