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


// Trial tiers: only platform_owner / platform_admin hold organisations:write.
const canWrite = requirePermission('organisations', 'write');
router.post('/organizations/:id/extended-trial', canWrite, validate(schema.grantTrialSchema), controller.grantTrial.bind(controller));
router.delete('/organizations/:id/extended-trial', canWrite, validate(schema.orgIdSchema), controller.revokeTrial.bind(controller));
router.get('/trial-selections', controller.listSelections.bind(controller));
router.post('/trial-selections', canWrite, validate(schema.addSelectionSchema), controller.addSelection.bind(controller));
router.delete('/trial-selections/:id', canWrite, validate(schema.selectionIdSchema), controller.removeSelection.bind(controller));

module.exports = router;
