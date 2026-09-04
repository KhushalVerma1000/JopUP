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
router.delete('/:id', requirePermission('job_postings', 'delete'), validate(schema.jobPostingParamsSchema), controller.remove.bind(controller));

router.post('/:id/publish', requirePermission('job_postings', 'publish'), validate(schema.jobPostingParamsSchema), controller.publish.bind(controller));
router.post('/:id/close', requirePermission('job_postings', 'close'), validate(schema.jobPostingParamsSchema), controller.close.bind(controller));

module.exports = router;
