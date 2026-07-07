const express = require('express');
const router = express.Router();
const controller = require('./performance.controller');
const validate = require('../../middlewares/validate');
const schema = require('./performance.schema');

// KPIs
router.get('/kpis', controller.listKpis.bind(controller));
router.post('/kpis', validate(schema.createKpiSchema), controller.createKpi.bind(controller));
router.patch('/kpis/:id', validate(schema.updateKpiSchema), controller.updateKpi.bind(controller));

// KPI Entries
router.get('/kpis/:id/entries', validate(schema.genericParamsSchema), controller.listKpiEntries.bind(controller));
router.post('/kpi-entries', validate(schema.createKpiEntrySchema), controller.createKpiEntry.bind(controller));

// Reviews
router.get('/reviews', controller.listReviews.bind(controller));
router.post('/reviews', validate(schema.createReviewSchema), controller.createReview.bind(controller));
router.patch('/reviews/:id', validate(schema.updateReviewSchema), controller.updateReview.bind(controller));

// Goals
router.get('/goals', controller.listGoals.bind(controller));
router.post('/goals', validate(schema.createGoalSchema), controller.createGoal.bind(controller));
router.patch('/goals/:id', validate(schema.updateGoalSchema), controller.updateGoal.bind(controller));

// Strategies
router.get('/strategies', controller.listStrategies.bind(controller));
router.post('/strategies', validate(schema.createStrategySchema), controller.createStrategy.bind(controller));
router.patch('/strategies/:id', validate(schema.updateStrategySchema), controller.updateStrategy.bind(controller));

module.exports = router;
