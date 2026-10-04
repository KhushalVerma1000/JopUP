const express = require('express');
const router = express.Router();
const controller = require('./daily-trackers.controller');
const validate = require('../../middlewares/validate');
const schema = require('./daily-trackers.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');
const requireModule = require('../../middlewares/requireModule');

// Gated on the pipeline tracker module (what the data comes from). Once
// 'client_communication' is part of the plans, add it here too: this feature
// sends mail to client contacts.
router.use(requireAuth, requireModule('pipeline_tracker'));

router.get('/overview', requirePermission('daily_trackers', 'read'), validate(schema.overviewSchema), controller.overview.bind(controller));
router.get('/schedules', requirePermission('daily_trackers', 'read'), validate(schema.listSchedulesSchema), controller.listSchedules.bind(controller));
router.post('/schedules', requirePermission('daily_trackers', 'write'), validate(schema.createScheduleSchema), controller.createSchedule.bind(controller));
router.patch('/schedules/:id', requirePermission('daily_trackers', 'write'), validate(schema.updateScheduleSchema), controller.updateSchedule.bind(controller));
router.delete('/schedules/:id', requirePermission('daily_trackers', 'write'), validate(schema.scheduleParamsSchema), controller.deleteSchedule.bind(controller));
router.post('/schedules/:id/send', requirePermission('daily_trackers', 'send'), validate(schema.scheduleParamsSchema), controller.sendNow.bind(controller));
router.get('/schedules/:id/runs', requirePermission('daily_trackers', 'read'), validate(schema.scheduleParamsSchema), controller.listRuns.bind(controller));

module.exports = router;
