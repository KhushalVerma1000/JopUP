const express = require('express');
const router = express.Router();
const controller = require('./platform-admins.controller');
const validate = require('../../middlewares/validate');
const schema = require('./platform-admins.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');

router.use(requireAuth);

// Only platform_owner holds the 'platform_admins' permission key (seed.ts,
// patch 6) — regular platform_admin sub-admins get 403 on all three of these.
router.get('/', requirePermission('platform_admins', 'read'), controller.list.bind(controller));
router.post('/', requirePermission('platform_admins', 'write'), validate(schema.createPlatformAdminSchema), controller.create.bind(controller));
router.delete('/:userId', requirePermission('platform_admins', 'delete'), validate(schema.platformAdminParamsSchema), controller.remove.bind(controller));

module.exports = router;
