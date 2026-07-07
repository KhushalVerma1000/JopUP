const express = require('express');
const router = express.Router();
const controller = require('./teams.controller');
const validate = require('../../middlewares/validate');
const schema = require('./teams.schema');

router.get('/', controller.list.bind(controller));
router.get('/:id', validate(schema.getTeamParamsSchema), controller.getById.bind(controller));
router.post('/', validate(schema.createTeamSchema), controller.create.bind(controller));
router.patch('/:id', validate(schema.updateTeamSchema), controller.update.bind(controller));
router.delete('/:id', validate(schema.getTeamParamsSchema), controller.remove.bind(controller));

module.exports = router;
