const express = require('express');
const router = express.Router();
const controller = require('./candidates.controller');
const validate = require('../../middlewares/validate');
const schema = require('./candidates.schema');

router.get('/', controller.list.bind(controller));
router.get('/:id', validate(schema.getCandidateParamsSchema), controller.getById.bind(controller));
router.post('/', validate(schema.createCandidateSchema), controller.create.bind(controller));
router.patch('/:id', validate(schema.updateCandidateSchema), controller.update.bind(controller));
router.delete('/:id', validate(schema.getCandidateParamsSchema), controller.remove.bind(controller));
router.post('/:id/access', validate(schema.grantAccessSchema), controller.grantAccess.bind(controller));

module.exports = router;
