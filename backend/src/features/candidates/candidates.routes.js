const express = require('express');
const router = express.Router();
const controller = require('./candidates.controller');
const validate = require('../../middlewares/validate');
const schema = require('./candidates.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');
const requireModule = require('../../middlewares/requireModule');

router.use(requireAuth, requireModule('candidate_db'));

router.get('/', requirePermission('candidates', 'read'), controller.list.bind(controller));
router.get('/:id', requirePermission('candidates', 'read'), validate(schema.getCandidateParamsSchema), controller.getById.bind(controller));
router.post('/', requirePermission('candidates', 'write'), validate(schema.createCandidateSchema), controller.create.bind(controller));
router.patch('/:id', requirePermission('candidates', 'write'), validate(schema.updateCandidateSchema), controller.update.bind(controller));
// NOTE: no role currently grants candidates:delete in the seed data (src/seed.ts) —
// left behind requireAuth only until product decides who may hard-delete a candidate.
router.delete('/:id', validate(schema.getCandidateParamsSchema), controller.remove.bind(controller));
router.post('/:id/access', requirePermission('candidates', 'share'), validate(schema.grantAccessSchema), controller.grantAccess.bind(controller));

module.exports = router;
