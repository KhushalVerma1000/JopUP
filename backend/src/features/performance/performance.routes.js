const express = require('express');
const router = express.Router();
const c = require('./performance.controller');
const validate = require('../../middlewares/validate');
const s = require('./performance.schema');
const { requireAuth, requirePermission } = require('../../middlewares/requireAuth');
const requireModule = require('../../middlewares/requireModule');
const metrics = require('./metrics.service');

const h = (fn) => fn.bind(c);
router.use(requireAuth);

// Each area is gated by its own plan module (kpi_engine / performance_reviews /
// strategy_planner) and by its own permission key. Team reach (which teams'
// rows a caller may read or change) is enforced in the service, because a
// permission key alone can't express "manager of team A, HR in team B".
const kpiEngine = requireModule('kpi_engine');
const reviewsModule = requireModule('performance_reviews');
const strategyModule = requireModule('strategy_planner');

// Roll-up for dashboards (KPIs + goals + review queue per team)
router.get('/overview', kpiEngine, requirePermission('kpi', 'read'), h(c.overview));

// The metric catalogue: what a KPI, goal or key result can be measured by (static, read-only).
router.get('/metrics', (req, res) => res.json({ status: 'success', data: { metrics: metrics.catalogue() } }));

// Recompute everything automatic in the teams the caller manages.
router.post('/sync', kpiEngine, requirePermission('kpi', 'write'), validate(s.syncSchema), h(c.syncNow));

// KPIs
router.get('/kpis', kpiEngine, requirePermission('kpi', 'read'), validate(s.listKpisSchema), h(c.listKpis));
router.post('/kpis', kpiEngine, requirePermission('kpi', 'write'), validate(s.createKpiSchema), h(c.createKpi));
router.patch('/kpis/:id', kpiEngine, requirePermission('kpi', 'write'), validate(s.updateKpiSchema), h(c.updateKpi));
router.get('/kpis/:id/entries', kpiEngine, requirePermission('kpi', 'read'), validate(s.kpiEntriesSchema), h(c.listKpiEntries));
router.post('/kpis/:id/recompute', kpiEngine, requirePermission('kpi', 'write'), validate(s.idParamsSchema), h(c.recomputeKpi));
router.post('/kpi-entries', kpiEngine, requirePermission('kpi', 'write'), validate(s.createKpiEntrySchema), h(c.createKpiEntry));
router.delete('/kpi-entries/:id/override', kpiEngine, requirePermission('kpi', 'write'), validate(s.entryIdParamsSchema), h(c.revertKpiOverride));

// Reviews
router.get('/reviews', reviewsModule, requirePermission('performance_reviews', 'read'), validate(s.listReviewsSchema), h(c.listReviews));
router.post('/reviews', reviewsModule, requirePermission('performance_reviews', 'write'), validate(s.createReviewSchema), h(c.createReview));
router.patch('/reviews/:id', reviewsModule, requirePermission('performance_reviews', 'write'), validate(s.updateReviewSchema), h(c.updateReview));
// No write permission needed: the service only lets the reviewee through.
router.post('/reviews/:id/acknowledge', reviewsModule, requirePermission('performance_reviews', 'read'), validate(s.idParamsSchema), h(c.acknowledgeReview));

// Goals
router.get('/goals', kpiEngine, requirePermission('goals', 'read'), validate(s.listGoalsSchema), h(c.listGoals));
router.post('/goals', kpiEngine, requirePermission('goals', 'write'), validate(s.createGoalSchema), h(c.createGoal));
router.patch('/goals/:id', kpiEngine, requirePermission('goals', 'write'), validate(s.updateGoalSchema), h(c.updateGoal));
// The assignee reports their own progress; the service checks assignedTo === caller.
router.patch('/goals/:id/progress', kpiEngine, requirePermission('goals', 'read'), validate(s.goalProgressSchema), h(c.updateGoalProgress));

// Strategy
router.get('/strategies', strategyModule, requirePermission('strategy', 'read'), validate(s.listStrategiesSchema), h(c.listStrategies));
router.post('/strategies', strategyModule, requirePermission('strategy', 'write'), validate(s.createStrategySchema), h(c.createStrategy));
router.patch('/strategies/:id', strategyModule, requirePermission('strategy', 'write'), validate(s.updateStrategySchema), h(c.updateStrategy));

module.exports = router;
