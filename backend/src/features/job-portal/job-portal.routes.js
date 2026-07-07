const express = require('express');
const router = express.Router();
const controller = require('./job-portal.controller');
const validate = require('../../middlewares/validate');
const schema = require('./job-portal.schema');

// Note: These routes are public. They do NOT use the tenant/auth middleware.
// The URL should be something like /api/v1/portal/:orgSlug/...

// Middleware to resolve organization
router.use('/:orgSlug', validate(schema.getPortalOrgParamsSchema), controller.resolveOrg.bind(controller));

// Public routes for the portal
router.get('/:orgSlug', controller.getOrgProfile.bind(controller));
router.get('/:orgSlug/jobs', controller.listJobs.bind(controller));
router.get('/:orgSlug/jobs/:jobId', validate(schema.getPortalJobParamsSchema), controller.getJob.bind(controller));

// Submission route
router.post('/:orgSlug/apply', validate(schema.portalSubmitApplicationSchema), controller.apply.bind(controller));

module.exports = router;
