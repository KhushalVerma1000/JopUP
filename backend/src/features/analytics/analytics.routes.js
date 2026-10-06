const express = require('express');
const router = express.Router();
const controller = require('./analytics.controller');
const validate = require('../../middlewares/validate');
const schema = require('./analytics.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');
const requireModule = require('../../middlewares/requireModule');

// Pipeline analytics are a view over tracker data, so they ride on the same
// module + permission as the trackers themselves. The separate `analytics`
// plan module is kept for the heavier cross-team / export features to come.
router.use(requireAuth, requireModule('pipeline_tracker'));

router.get('/pipeline', requirePermission('trackers', 'read'), validate(schema.pipelineQuerySchema), controller.pipeline.bind(controller));

module.exports = router;
