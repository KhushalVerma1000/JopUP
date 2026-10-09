const express = require('express');
const router = express.Router();
const controller = require('./mail.controller');
const validate = require('../../middlewares/validate');
const schema = require('./mail.schema');
const tplSchema = require('./templates.schema');
const tpl = require('./templates.controller');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');
const requireModule = require('../../middlewares/requireModule');

router.use(requireAuth, requireModule('pipeline_tracker'));

// Composing is reading the pipeline and formatting it, so it rides on
// trackers:read (HR already has it). Sending will get its own key.
router.post('/compose', requirePermission('trackers', 'read'), validate(schema.composeSchema), controller.compose.bind(controller));

// Tracker templates (which columns a client tracker mail shows). Managers write, HR reads.
const R = requirePermission;
router.get('/columns', R('tracker_templates', 'read'), tpl.catalogue.bind(tpl));
router.get('/templates', R('tracker_templates', 'read'), tpl.list.bind(tpl));
router.get('/templates/:id', R('tracker_templates', 'read'), validate(tplSchema.templateParamsSchema), tpl.get.bind(tpl));
router.post('/templates', R('tracker_templates', 'write'), validate(tplSchema.createTemplateSchema), tpl.create.bind(tpl));
router.patch('/templates/:id', R('tracker_templates', 'write'), validate(tplSchema.updateTemplateSchema), tpl.update.bind(tpl));
router.delete('/templates/:id', R('tracker_templates', 'write'), validate(tplSchema.templateParamsSchema), tpl.remove.bind(tpl));

module.exports = router;
