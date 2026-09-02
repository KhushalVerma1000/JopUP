const express = require('express');
const router = express.Router();
const controller = require('./job-postings.controller');
const validate = require('../../middlewares/validate');
const schema = require('./job-postings.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');
const requireModule = require('../../middlewares/requireModule');

router.use(requireAuth, requireModule('job_posting'));

router.get('/', requirePermission('job_postings', 'read'), controller.list.bind(controller));
router.get('/:id', requirePermission('job_postings', 'read'), validate(schema.jobPostingParamsSchema), controller.getById.bind(controller));
router.post('/', requirePermission('job_postings', 'write'), validate(schema.createJobPostingSchema), controller.create.bind(controller));
router.patch('/:id', requirePermission('job_postings', 'write'), validate(schema.updateJobPostingSchema), controller.update.bind(controller));
// NOTE: no role grants job_postings:delete in seed.ts (org_admin has 'archive' instead) —
// left behind requireAuth only; likely 'remove' should call archive semantics, follow-up.
router.delete('/:id', validate(schema.jobPostingParamsSchema), controller.remove.bind(controller));

router.post('/:id/publish', requirePermission('job_postings', 'publish'), validate(schema.jobPostingParamsSchema), controller.publish.bind(controller));
// NOTE: 'close' has no matching permission action in seed.ts (only 'publish'/'archive' exist) —
// left behind requireAuth only pending a product decision on the right permission key.
router.post('/:id/close', validate(schema.jobPostingParamsSchema), controller.close.bind(controller));

module.exports = router;
