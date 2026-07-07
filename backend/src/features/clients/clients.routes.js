const express = require('express');
const router = express.Router();
const controller = require('./clients.controller');
const validate = require('../../middlewares/validate');
const schema = require('./clients.schema');

router.get('/', controller.list.bind(controller));
router.get('/:id', validate(schema.getClientParamsSchema), controller.getById.bind(controller));
router.post('/', validate(schema.createClientSchema), controller.create.bind(controller));
router.patch('/:id', validate(schema.updateClientSchema), controller.update.bind(controller));
router.delete('/:id', validate(schema.getClientParamsSchema), controller.remove.bind(controller));
router.post('/:id/share', validate(schema.shareClientSchema), controller.share.bind(controller));

module.exports = router;
