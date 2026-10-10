const express = require('express');
const router = express.Router();
const controller = require('./clients.controller');
const validate = require('../../middlewares/validate');
const schema = require('./clients.schema');
const loc = require('./locations.controller');
const locSchema = require('./locations.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');
const requireModule = require('../../middlewares/requireModule');

router.use(requireAuth, requireModule('client_management'));

router.get('/', requirePermission('clients', 'read'), controller.list.bind(controller));
router.get('/:id', requirePermission('clients', 'read'), validate(schema.getClientParamsSchema), controller.getById.bind(controller));
router.post('/', requirePermission('clients', 'write'), validate(schema.createClientSchema), controller.create.bind(controller));
router.patch('/:id', requirePermission('clients', 'write'), validate(schema.updateClientSchema), controller.update.bind(controller));
router.delete('/:id', requirePermission('clients', 'delete'), validate(schema.getClientParamsSchema), controller.remove.bind(controller));
router.post('/:id/share', requirePermission('clients', 'share'), validate(schema.shareClientSchema), controller.share.bind(controller));

// Mail profile: locations (with the spellings that map to them), their contacts, and the send history.
const R = requirePermission;
router.get('/:id/mail-profile', R('clients', 'read'), validate(locSchema.listSchema), loc.profile.bind(loc));
router.get('/:id/mail-log', R('clients', 'read'), validate(locSchema.listSchema), loc.mailLog.bind(loc));
router.post('/:id/locations', R('clients', 'write'), validate(locSchema.createLocationSchema), loc.createLocation.bind(loc));
router.patch('/:id/locations/:locationId', R('clients', 'write'), validate(locSchema.updateLocationSchema), loc.updateLocation.bind(loc));
router.delete('/:id/locations/:locationId', R('clients', 'write'), validate(locSchema.locationParams), loc.removeLocation.bind(loc));
router.post('/:id/contacts', R('clients', 'write'), validate(locSchema.createContactSchema), loc.createContact.bind(loc));
router.patch('/:id/contacts/:contactId', R('clients', 'write'), validate(locSchema.updateContactSchema), loc.updateContact.bind(loc));
router.delete('/:id/contacts/:contactId', R('clients', 'write'), validate(locSchema.contactParams), loc.removeContact.bind(loc));

module.exports = router;
