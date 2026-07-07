const express = require('express');
const router = express.Router();
const controller = require('./applications.controller');
const validate = require('../../middlewares/validate');
const schema = require('./applications.schema');

router.get('/', controller.list.bind(controller));
router.get('/:id', validate(schema.applicationParamsSchema), controller.getById.bind(controller));
router.post('/', validate(schema.createApplicationSchema), controller.create.bind(controller));

router.post('/:id/advance', validate(schema.advanceStageSchema), controller.advanceStage.bind(controller));
router.post('/:id/block', validate(schema.blockApplicationSchema), controller.block.bind(controller));
router.post('/:id/hold', validate(schema.applicationParamsSchema), controller.hold.bind(controller));

router.get('/:id/history', validate(schema.applicationParamsSchema), controller.getHistory.bind(controller));
router.post('/:id/stages/:logId/actions', validate(schema.addActionSchema), controller.addAction.bind(controller));

module.exports = router;
