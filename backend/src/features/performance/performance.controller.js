const perf = require('./performance.service');
const { canActOnTeam } = require('../../utils/teamScope');
const { ForbiddenError } = require('../../utils/errors');

// A write that names a team must be to a team where the caller holds that permission.
function requireTeamWrite(req, teamId, entity) {
  if (!canActOnTeam(req.user, teamId, entity, 'write')) throw new ForbiddenError('You don\'t have access to that team');
}

const ok = (res, data, status = 200) => res.status(status).json({ status: 'success', data });

class PerformanceController {
  // KPIs
  async listKpis(req, res) { ok(res, { kpis: await perf.listKpis(req.tenantId, req.user, req.query) }); }
  async createKpi(req, res) {
    requireTeamWrite(req, req.body.teamId, 'kpi');
    ok(res, { kpi: await perf.createKpiDefinition(req.tenantId, req.body, req.user.userId) }, 201);
  }
  async updateKpi(req, res) { ok(res, { kpi: await perf.updateKpiDefinition(req.tenantId, req.user, req.params.id, req.body) }); }
  async listKpiEntries(req, res) { ok(res, { entries: await perf.getKpiEntries(req.tenantId, req.user, req.params.id, req.query) }); }
  async createKpiEntry(req, res) {
    const { entry, replaced } = await perf.recordKpiEntry(req.tenantId, req.user, req.body);
    ok(res, { entry, replaced }, replaced ? 200 : 201);
  }

  // Reviews
  async listReviews(req, res) { ok(res, { reviews: await perf.getReviews(req.tenantId, req.user, req.query) }); }
  async createReview(req, res) {
    requireTeamWrite(req, req.body.teamId, 'performance_reviews');
    ok(res, { review: await perf.createReview(req.tenantId, req.user, req.body) }, 201);
  }
  async updateReview(req, res) { ok(res, { review: await perf.updateReview(req.tenantId, req.user, req.params.id, req.body) }); }
  async acknowledgeReview(req, res) { ok(res, { review: await perf.acknowledgeReview(req.tenantId, req.user, req.params.id) }); }

  // Goals
  async listGoals(req, res) { ok(res, { goals: await perf.getGoals(req.tenantId, req.user, req.query) }); }
  async createGoal(req, res) {
    requireTeamWrite(req, req.body.teamId, 'goals');
    ok(res, { goal: await perf.createGoal(req.tenantId, req.user, req.body) }, 201);
  }
  async updateGoal(req, res) { ok(res, { goal: await perf.updateGoal(req.tenantId, req.user, req.params.id, req.body) }); }
  async updateGoalProgress(req, res) { ok(res, { goal: await perf.updateGoalProgress(req.tenantId, req.user, req.params.id, req.body) }); }

  // Strategy
  async listStrategies(req, res) { ok(res, { strategies: await perf.getStrategies(req.tenantId, req.user, req.query) }); }
  async createStrategy(req, res) {
    requireTeamWrite(req, req.body.teamId, 'strategy');
    ok(res, { strategy: await perf.createStrategy(req.tenantId, req.user, req.body) }, 201);
  }
  async updateStrategy(req, res) { ok(res, { strategy: await perf.updateStrategy(req.tenantId, req.user, req.params.id, req.body) }); }

  // Roll-up
  async overview(req, res) { ok(res, await perf.getOverview(req.tenantId, req.user)); }
}

module.exports = new PerformanceController();
