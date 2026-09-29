const express = require('express');
const router = express.Router();
const controller = require('./open-positions.controller');
const validate = require('../../middlewares/validate');
const schema = require('./open-positions.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');
const requireModule = require('../../middlewares/requireModule');

// Gated the same as job postings — see 17-open-position.ts's module_key note.
// A requisition is core recruitment demand, already covered by every plan
// that includes job postings; it doesn't need its own module toggle.
router.use(requireAuth, requireModule('job_posting'));

router.get('/', requirePermission('open_positions', 'read'), controller.list.bind(controller));
router.get('/:id', requirePermission('open_positions', 'read'), validate(schema.openPositionParamsSchema), controller.getById.bind(controller));
router.post('/', requirePermission('open_positions', 'write'), validate(schema.createOpenPositionSchema), controller.create.bind(controller));
router.patch('/:id', requirePermission('open_positions', 'write'), validate(schema.updateOpenPositionSchema), controller.update.bind(controller));
router.delete('/:id', requirePermission('open_positions', 'delete'), validate(schema.openPositionParamsSchema), controller.remove.bind(controller));

module.exports = router;
