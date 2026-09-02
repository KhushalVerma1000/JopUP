const express = require('express');
const router = express.Router();
const controller = require('./applications.controller');
const validate = require('../../middlewares/validate');
const schema = require('./applications.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');
const requireModule = require('../../middlewares/requireModule');

router.use(requireAuth, requireModule('pipeline_tracker'));

// NOTE: seed.ts has no standalone 'applications' permission key — list/get/create
// are left behind requireAuth + module gating only pending that product decision.
router.get('/', controller.list.bind(controller));
router.get('/:id', validate(schema.applicationParamsSchema), controller.getById.bind(controller));
router.post('/', validate(schema.createApplicationSchema), controller.create.bind(controller));

router.post('/:id/advance', requirePermission('workflow', 'advance'), validate(schema.advanceStageSchema), controller.advanceStage.bind(controller));
router.post('/:id/block', requirePermission('workflow', 'block'), validate(schema.blockApplicationSchema), controller.block.bind(controller));
router.post('/:id/hold', requirePermission('workflow', 'hold'), validate(schema.applicationParamsSchema), controller.hold.bind(controller));

router.get('/:id/history', validate(schema.applicationParamsSchema), controller.getHistory.bind(controller));
router.post('/:id/stages/:logId/actions', validate(schema.addActionSchema), controller.addAction.bind(controller));

module.exports = router;
