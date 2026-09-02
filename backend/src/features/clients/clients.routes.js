const express = require('express');
const router = express.Router();
const controller = require('./clients.controller');
const validate = require('../../middlewares/validate');
const schema = require('./clients.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');
const requireModule = require('../../middlewares/requireModule');

router.use(requireAuth, requireModule('client_management'));

router.get('/', requirePermission('clients', 'read'), controller.list.bind(controller));
router.get('/:id', requirePermission('clients', 'read'), validate(schema.getClientParamsSchema), controller.getById.bind(controller));
router.post('/', requirePermission('clients', 'write'), validate(schema.createClientSchema), controller.create.bind(controller));
router.patch('/:id', requirePermission('clients', 'write'), validate(schema.updateClientSchema), controller.update.bind(controller));
router.delete('/:id', requirePermission('clients', 'delete'), validate(schema.getClientParamsSchema), controller.remove.bind(controller));
router.post('/:id/share', requirePermission('clients', 'share'), validate(schema.shareClientSchema), controller.share.bind(controller));

module.exports = router;
