const express = require('express');
const router = express.Router();
const controller = require('./workflow.controller');
const validate = require('../../middlewares/validate');
const schema = require('./workflow.schema');
const { requireAuth } = require('../../middlewares/requireAuth');
const requireModule = require('../../middlewares/requireModule');

router.use(requireAuth, requireModule('workflow_engine'));

// NOTE: seed.ts only grants workflow:read/write to org_admin — manager/hr only
// have workflow:[advance,block,hold,approve] (used on the application-level
// actions in applications.routes.js). Template CRUD here is therefore left
// behind requireAuth + module gating only; restricting it to org_admin would
// block managers/hr from ever viewing templates, which is likely wrong too.
// Flagging for a product decision rather than guessing.
router.get('/', controller.listTemplates.bind(controller));
router.post('/', validate(schema.createTemplateSchema), controller.createTemplate.bind(controller));
router.get('/:id', validate(schema.templateParamsSchema), controller.getTemplate.bind(controller));
router.patch('/:id', validate(schema.updateTemplateSchema), controller.updateTemplate.bind(controller));
router.delete('/:id', validate(schema.templateParamsSchema), controller.deleteTemplate.bind(controller));

router.get('/:templateId/stages', validate(schema.stageParamsSchema), controller.listStages.bind(controller));
router.post('/:templateId/stages', validate(schema.createStageSchema), controller.createStage.bind(controller));
router.patch('/:templateId/stages/:stageId', validate(schema.stageParamsSchema), controller.updateStage.bind(controller));
router.delete('/:templateId/stages/:stageId', validate(schema.stageParamsSchema), controller.deleteStage.bind(controller));

module.exports = router;
