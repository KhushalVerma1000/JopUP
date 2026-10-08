const express = require('express');
const router = express.Router();
const controller = require('./mail.controller');
const validate = require('../../middlewares/validate');
const schema = require('./mail.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');
const requireModule = require('../../middlewares/requireModule');

router.use(requireAuth, requireModule('pipeline_tracker'));

// Composing is reading the pipeline and formatting it, so it rides on
// trackers:read (HR already has it). Sending will get its own key.
router.post('/compose', requirePermission('trackers', 'read'), validate(schema.composeSchema), controller.compose.bind(controller));

module.exports = router;
