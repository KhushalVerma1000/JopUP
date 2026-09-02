const express = require('express');
const router = express.Router();
const controller = require('./performance.controller');
const validate = require('../../middlewares/validate');
const schema = require('./performance.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');
const requireModule = require('../../middlewares/requireModule');

router.use(requireAuth, requireModule('kpi_engine'));

// KPIs
router.get('/kpis', requirePermission('kpi', 'read'), controller.listKpis.bind(controller));
router.post('/kpis', requirePermission('kpi', 'write'), validate(schema.createKpiSchema), controller.createKpi.bind(controller));
router.patch('/kpis/:id', requirePermission('kpi', 'write'), validate(schema.updateKpiSchema), controller.updateKpi.bind(controller));

// KPI Entries — no dedicated permission key in seed.ts; gated by module + auth only.
router.get('/kpis/:id/entries', validate(schema.genericParamsSchema), controller.listKpiEntries.bind(controller));
router.post('/kpi-entries', validate(schema.createKpiEntrySchema), controller.createKpiEntry.bind(controller));

// Reviews
router.get('/reviews', requirePermission('performance_reviews', 'read'), controller.listReviews.bind(controller));
router.post('/reviews', requirePermission('performance_reviews', 'write'), validate(schema.createReviewSchema), controller.createReview.bind(controller));
router.patch('/reviews/:id', requirePermission('performance_reviews', 'write'), validate(schema.updateReviewSchema), controller.updateReview.bind(controller));

// Goals
router.get('/goals', requirePermission('goals', 'read'), controller.listGoals.bind(controller));
router.post('/goals', requirePermission('goals', 'write'), validate(schema.createGoalSchema), controller.createGoal.bind(controller));
router.patch('/goals/:id', requirePermission('goals', 'write'), validate(schema.updateGoalSchema), controller.updateGoal.bind(controller));

// Strategies — 'strategy' permission only exists on the manager role in seed.ts
// (org_admin/hr don't have it explicitly). Left behind requireAuth + module only
// to avoid locking out org_admin, pending a seed-data fix.
router.get('/strategies', controller.listStrategies.bind(controller));
router.post('/strategies', validate(schema.createStrategySchema), controller.createStrategy.bind(controller));
router.patch('/strategies/:id', validate(schema.updateStrategySchema), controller.updateStrategy.bind(controller));

module.exports = router;
