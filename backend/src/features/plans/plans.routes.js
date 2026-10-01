const express = require('express');
const router = express.Router();
const controller = require('./plans.controller');
const validate = require('../../middlewares/validate');
const schema = require('./plans.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');

router.get('/', controller.list.bind(controller));
router.get('/:id', validate(schema.getPlanParamsSchema), controller.getById.bind(controller));
// Create/update were previously unauthenticated — anyone could rewrite a plan's
// price, modules or limits. Now platform staff only (plans:write).
router.post('/', requireAuth, requirePermission('plans', 'write'), validate(schema.createPlanSchema), controller.create.bind(controller));
router.patch('/:id', requireAuth, requirePermission('plans', 'write'), validate(schema.updatePlanSchema), controller.update.bind(controller));

module.exports = router;
