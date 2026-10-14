const express = require('express');
const router = express.Router();
const svc = require('./automation.service');
const validate = require('../../middlewares/validate');
const schema = require('./automation.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');
const requireModule = require('../../middlewares/requireModule');

const ok = (res, data, code = 200) => res.status(code).json({ status: 'success', data });

router.use(requireAuth, requireModule('pipeline_tracker'));

// Rules ride on the same keys as tracker templates: managers write, HR can read what is switched on.
const R = requirePermission;
router.get('/options', R('tracker_templates', 'read'), async (req, res) => ok(res, await svc.options(req.tenantId)));
router.get('/rules', R('tracker_templates', 'read'), async (req, res) => ok(res, await svc.list(req.tenantId)));
router.post('/rules', R('tracker_templates', 'write'), validate(schema.createRuleSchema), async (req, res) => ok(res, await svc.create(req.tenantId, req.user, req.body), 201));
router.patch('/rules/:id', R('tracker_templates', 'write'), validate(schema.updateRuleSchema), async (req, res) => ok(res, await svc.update(req.tenantId, req.user, req.params.id, req.body)));
router.delete('/rules/:id', R('tracker_templates', 'write'), validate(schema.ruleParamsSchema), async (req, res) => { await svc.remove(req.tenantId, req.user, req.params.id); res.status(204).end(); });

module.exports = router;
