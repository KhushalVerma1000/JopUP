const express = require('express');
const router = express.Router();
const controller = require('./trackers.controller');
const validate = require('../../middlewares/validate');
const schema = require('./trackers.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');
const requireModule = require('../../middlewares/requireModule');

router.use(requireAuth, requireModule('pipeline_tracker'));

router.get('/', requirePermission('trackers', 'read'), controller.list.bind(controller));
router.get('/summary', requirePermission('trackers', 'read'), controller.getSummary.bind(controller));
// Bulk changes. Registered before the /:id routes. Dates ride on trackers:write;
// a status change needs the same workflow_actions key as the single-candidate
// route, picked from the validated body (resume uses the hold key, as it does singly).
const BULK_ACTION_KEY = { advance: 'advance', block: 'block', hold: 'hold', resume: 'hold' };
router.post('/bulk/dates', validate(schema.bulkDatesSchema), requirePermission('trackers', 'write'), controller.bulkDates.bind(controller));
router.post('/bulk/status', validate(schema.bulkStatusSchema), (req, res, next) => requirePermission('workflow_actions', BULK_ACTION_KEY[req.body.action])(req, res, next), controller.bulkStatus.bind(controller));

router.get('/:id', requirePermission('trackers', 'read'), validate(schema.trackerParamsSchema), controller.getById.bind(controller));
router.get('/:id/history', requirePermission('trackers', 'read'), validate(schema.trackerParamsSchema), controller.getHistory.bind(controller));
router.post('/', requirePermission('trackers', 'write'), validate(schema.createTrackerSchema), controller.create.bind(controller));
router.post('/tag', requirePermission('trackers', 'write'), validate(schema.tagCandidatesSchema), controller.tag.bind(controller));

// Reuses the existing workflow_actions permission key and its specific
// action names (advance/block/hold/approve) — requirePermission does an
// exact string match against seed.ts's permission arrays, so this must
// use the same action keys, not a generic 'write' (which workflow_actions
// never grants — every role's list is exactly ["advance","block","hold"]
// or with "approve" added for org_admin/manager).
router.patch('/:id', requirePermission('trackers', 'write'), validate(schema.updateTrackerSchema), controller.update.bind(controller));
router.post('/:id/advance', requirePermission('workflow_actions', 'advance'), validate(schema.advanceStageSchema), controller.advanceStage.bind(controller));
router.post('/:id/block', requirePermission('workflow_actions', 'block'), validate(schema.blockTrackerSchema), controller.block.bind(controller));
router.post('/:id/hold', requirePermission('workflow_actions', 'hold'), validate(schema.trackerParamsSchema), controller.hold.bind(controller));
router.post('/:id/resume', requirePermission('workflow_actions', 'hold'), validate(schema.trackerParamsSchema), controller.resume.bind(controller));
// Logging a granular action (a note/call/email) isn't a stage transition,
// so it's gated as a tracker write, not a workflow_actions key.
router.post('/:id/stages/:logId/actions', requirePermission('trackers', 'write'), validate(schema.addActionSchema), controller.addAction.bind(controller));

module.exports = router;
