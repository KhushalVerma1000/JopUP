const express = require('express');
const router = express.Router();
const controller = require('./applications.controller');
const validate = require('../../middlewares/validate');
const schema = require('./applications.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');
const requireModule = require('../../middlewares/requireModule');

router.use(requireAuth, requireModule('pipeline_tracker'));

// list/get/create now use the 'applications' permission key added in patch 4.
router.get('/', requirePermission('applications', 'read'), controller.list.bind(controller));
router.get('/:id', requirePermission('applications', 'read'), validate(schema.applicationParamsSchema), controller.getById.bind(controller));
router.post('/', requirePermission('applications', 'write'), validate(schema.createApplicationSchema), controller.create.bind(controller));

// Stage-transition actions use 'workflow_actions' (renamed from the overloaded
// 'workflow' key, which is now template-CRUD only — see workflow.routes.js).
router.post('/:id/advance', requirePermission('workflow_actions', 'advance'), validate(schema.advanceStageSchema), controller.advanceStage.bind(controller));
router.post('/:id/block', requirePermission('workflow_actions', 'block'), validate(schema.blockApplicationSchema), controller.block.bind(controller));
router.post('/:id/hold', requirePermission('workflow_actions', 'hold'), validate(schema.applicationParamsSchema), controller.hold.bind(controller));

router.get('/:id/history', requirePermission('applications', 'read'), validate(schema.applicationParamsSchema), controller.getHistory.bind(controller));
router.post('/:id/stages/:logId/actions', requirePermission('applications', 'write'), validate(schema.addActionSchema), controller.addAction.bind(controller));

module.exports = router;
