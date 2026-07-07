const express = require('express');
const router = express.Router();
const controller = require('./job-postings.controller');
const validate = require('../../middlewares/validate');
const schema = require('./job-postings.schema');

router.get('/', controller.list.bind(controller));
router.get('/:id', validate(schema.jobPostingParamsSchema), controller.getById.bind(controller));
router.post('/', validate(schema.createJobPostingSchema), controller.create.bind(controller));
router.patch('/:id', validate(schema.updateJobPostingSchema), controller.update.bind(controller));
router.delete('/:id', validate(schema.jobPostingParamsSchema), controller.remove.bind(controller));

router.post('/:id/publish', validate(schema.jobPostingParamsSchema), controller.publish.bind(controller));
router.post('/:id/close', validate(schema.jobPostingParamsSchema), controller.close.bind(controller));

module.exports = router;
