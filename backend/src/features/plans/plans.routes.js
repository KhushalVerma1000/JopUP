const express = require('express');
const router = express.Router();
const controller = require('./plans.controller');
const validate = require('../../middlewares/validate');
const schema = require('./plans.schema');

router.get('/', controller.list.bind(controller));
router.get('/:id', validate(schema.getPlanParamsSchema), controller.getById.bind(controller));
router.post('/', validate(schema.createPlanSchema), controller.create.bind(controller));
router.patch('/:id', validate(schema.updatePlanSchema), controller.update.bind(controller));

module.exports = router;
