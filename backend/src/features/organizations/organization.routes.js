const express = require('express');
const router = express.Router();
const controller = require('./organization.controller');
const validate = require('../../middlewares/validate');
const schema = require('./organization.schema');

router.get('/', controller.list.bind(controller));
router.get('/:id', validate(schema.getOrgParamsSchema), controller.getById.bind(controller));
router.post('/', validate(schema.createOrganizationSchema), controller.create.bind(controller));
router.patch('/:id', validate(schema.updateOrganizationSchema), controller.update.bind(controller));
router.get('/:id/modules', validate(schema.getOrgParamsSchema), controller.getModules.bind(controller));

module.exports = router;
