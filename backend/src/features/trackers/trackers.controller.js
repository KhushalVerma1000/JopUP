const trackersService = require('./trackers.service');

class TrackersController {
  async list(req, res) {
    const orgId = req.tenantId;
    const { status, teamId, openPositionId } = req.query;
    const trackers = await trackersService.getAllTrackers(orgId, { status, teamId, openPositionId });
    res.json({ status: 'success', data: { trackers } });
  }

  async getById(req, res) {
    const orgId = req.tenantId;
    const { id } = req.params;
    const tracker = await trackersService.getTrackerById(orgId, id);
    res.json({ status: 'success', data: { tracker } });
  }

  async getSummary(req, res) {
    const orgId = req.tenantId;
    const { teamId, openPositionId } = req.query;
    const summary = await trackersService.getSummary(orgId, { teamId, openPositionId });
    res.json({ status: 'success', data: { summary } });
  }

  async create(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const tracker = await trackersService.createTracker(orgId, req.body, userId);
    res.status(201).json({ status: 'success', data: { tracker } });
  }

  async advanceStage(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    const { nextStageId } = req.body;
    const log = await trackersService.advanceStage(orgId, id, nextStageId, userId);
    res.json({ status: 'success', data: { log } });
  }

  async block(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    const { reason } = req.body;
    const tracker = await trackersService.blockTracker(orgId, id, reason, userId);
    res.json({ status: 'success', data: { tracker } });
  }

  async hold(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    const tracker = await trackersService.holdTracker(orgId, id, userId);
    res.json({ status: 'success', data: { tracker } });
  }

  async resume(req, res) {
    const tracker = await trackersService.resumeTracker(req.tenantId, req.params.id, req.user?.userId);
    res.json({ status: 'success', data: { tracker } });
  }

  async getHistory(req, res) {
    const { id } = req.params;
    const history = await trackersService.getStageHistory(id);
    res.json({ status: 'success', data: { history } });
  }

  async addAction(req, res) {
    const userId = req.user?.userId;
    const { logId } = req.params;
    const action = await trackersService.addStageAction(logId, req.body, userId);
    res.status(201).json({ status: 'success', data: { action } });
  }
}

module.exports = new TrackersController();
