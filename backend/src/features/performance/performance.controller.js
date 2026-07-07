const perfService = require('./performance.service');

class PerformanceController {
  // --- KPIs ---
  async listKpis(req, res) {
    const orgId = req.tenantId;
    const teamId = req.query.teamId;
    const kpis = await perfService.getKpiDefinitions(orgId, teamId);
    res.json({ status: 'success', data: { kpis } });
  }

  async createKpi(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const kpi = await perfService.createKpiDefinition(orgId, req.body, userId);
    res.status(201).json({ status: 'success', data: { kpi } });
  }

  async updateKpi(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    const kpi = await perfService.updateKpiDefinition(orgId, id, req.body, userId);
    res.json({ status: 'success', data: { kpi } });
  }

  async listKpiEntries(req, res) {
    const { id } = req.params; // kpiId
    const teamId = req.query.teamId;
    const entries = await perfService.getKpiEntries(id, teamId);
    res.json({ status: 'success', data: { entries } });
  }

  async createKpiEntry(req, res) {
    const userId = req.user?.userId;
    const entry = await perfService.createKpiEntry(req.body, userId);
    res.status(201).json({ status: 'success', data: { entry } });
  }

  // --- Reviews ---
  async listReviews(req, res) {
    const orgId = req.tenantId;
    const teamId = req.query.teamId;
    const reviews = await perfService.getReviews(orgId, teamId);
    res.json({ status: 'success', data: { reviews } });
  }

  async createReview(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const review = await perfService.createReview(orgId, req.body, userId);
    res.status(201).json({ status: 'success', data: { review } });
  }

  async updateReview(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    const review = await perfService.updateReview(orgId, id, req.body, userId);
    res.json({ status: 'success', data: { review } });
  }

  // --- Goals ---
  async listGoals(req, res) {
    const orgId = req.tenantId;
    const teamId = req.query.teamId;
    const goals = await perfService.getGoals(orgId, teamId);
    res.json({ status: 'success', data: { goals } });
  }

  async createGoal(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const goal = await perfService.createGoal(orgId, req.body, userId);
    res.status(201).json({ status: 'success', data: { goal } });
  }

  async updateGoal(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    const goal = await perfService.updateGoal(orgId, id, req.body, userId);
    res.json({ status: 'success', data: { goal } });
  }

  // --- Strategy ---
  async listStrategies(req, res) {
    const orgId = req.tenantId;
    const teamId = req.query.teamId;
    const strategies = await perfService.getStrategies(orgId, teamId);
    res.json({ status: 'success', data: { strategies } });
  }

  async createStrategy(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const strategy = await perfService.createStrategy(orgId, req.body, userId);
    res.status(201).json({ status: 'success', data: { strategy } });
  }

  async updateStrategy(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    const strategy = await perfService.updateStrategy(orgId, id, req.body, userId);
    res.json({ status: 'success', data: { strategy } });
  }
}

module.exports = new PerformanceController();
