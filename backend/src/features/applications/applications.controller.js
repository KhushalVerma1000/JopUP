const applicationsService = require('./applications.service');

class ApplicationsController {
  async list(req, res) {
    const orgId = req.tenantId;
    const { status, teamId, jobPostingId } = req.query;
    const applications = await applicationsService.getAllApplications(orgId, { status, teamId, jobPostingId });
    res.json({ status: 'success', data: { applications } });
  }

  async getById(req, res) {
    const orgId = req.tenantId;
    const { id } = req.params;
    const application = await applicationsService.getApplicationById(orgId, id);
    res.json({ status: 'success', data: { application } });
  }

  async create(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const application = await applicationsService.createApplication(orgId, req.body, userId);
    res.status(201).json({ status: 'success', data: { application } });
  }

  async advanceStage(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    const { nextStageId } = req.body;
    const log = await applicationsService.advanceStage(orgId, id, nextStageId, userId);
    res.json({ status: 'success', data: { log } });
  }

  async block(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    const { reason } = req.body;
    const application = await applicationsService.blockApplication(orgId, id, reason, userId);
    res.json({ status: 'success', data: { application } });
  }

  async hold(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    const application = await applicationsService.holdApplication(orgId, id, userId);
    res.json({ status: 'success', data: { application } });
  }

  async getHistory(req, res) {
    const { id } = req.params;
    const history = await applicationsService.getStageHistory(id);
    res.json({ status: 'success', data: { history } });
  }

  async addAction(req, res) {
    const userId = req.user?.userId;
    const { logId } = req.params;
    const action = await applicationsService.addStageAction(logId, req.body, userId);
    res.status(201).json({ status: 'success', data: { action } });
  }
}

module.exports = new ApplicationsController();
