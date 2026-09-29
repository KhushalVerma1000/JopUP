const express = require('express');
const router = express.Router();
const controller = require('./applications.controller');
const validate = require('../../middlewares/validate');
const schema = require('./applications.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');
const requireModule = require('../../middlewares/requireModule');

// ADR-1: advance/block/hold/history/actions moved to /api/v1/trackers —
// application only ever supports list/read/create now.
router.use(requireAuth, requireModule('pipeline_tracker'));

router.get('/', requirePermission('applications', 'read'), controller.list.bind(controller));
router.get('/:id', requirePermission('applications', 'read'), validate(schema.applicationParamsSchema), controller.getById.bind(controller));
router.post('/', requirePermission('applications', 'write'), validate(schema.createApplicationSchema), controller.create.bind(controller));

module.exports = router;
