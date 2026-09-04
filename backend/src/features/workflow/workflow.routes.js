const express = require('express');
const router = express.Router();
const controller = require('./workflow.controller');
const validate = require('../../middlewares/validate');
const schema = require('./workflow.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');
const requireModule = require('../../middlewares/requireModule');

router.use(requireAuth, requireModule('workflow_engine'));

// 'workflow' is now template-CRUD only (patch 4 split it from 'workflow_actions',
// which applications.routes.js uses for advance/block/hold/approve). All three
// org-scoped roles have workflow:read; only org_admin has workflow:write.
router.get('/', requirePermission('workflow', 'read'), controller.listTemplates.bind(controller));
router.post('/', requirePermission('workflow', 'write'), validate(schema.createTemplateSchema), controller.createTemplate.bind(controller));
router.get('/:id', requirePermission('workflow', 'read'), validate(schema.templateParamsSchema), controller.getTemplate.bind(controller));
router.patch('/:id', requirePermission('workflow', 'write'), validate(schema.updateTemplateSchema), controller.updateTemplate.bind(controller));
router.delete('/:id', requirePermission('workflow', 'write'), validate(schema.templateParamsSchema), controller.deleteTemplate.bind(controller));

router.get('/:templateId/stages', requirePermission('workflow', 'read'), validate(schema.stageParamsSchema), controller.listStages.bind(controller));
router.post('/:templateId/stages', requirePermission('workflow', 'write'), validate(schema.createStageSchema), controller.createStage.bind(controller));
router.patch('/:templateId/stages/:stageId', requirePermission('workflow', 'write'), validate(schema.stageParamsSchema), controller.updateStage.bind(controller));
router.delete('/:templateId/stages/:stageId', requirePermission('workflow', 'write'), validate(schema.stageParamsSchema), controller.deleteStage.bind(controller));

module.exports = router;
