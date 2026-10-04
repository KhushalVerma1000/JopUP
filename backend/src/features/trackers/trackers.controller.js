const trackersService = require('./trackers.service');
const { visibleTeamIds, canSeeTeam } = require('../../utils/teamScope');
const { ForbiddenError } = require('../../utils/errors');

// Writes that name a team must be to a team the caller actually belongs to.
function requireTeam(req, teamId) {
  if (!canSeeTeam(req.user, teamId)) throw new ForbiddenError('You don\'t have access to that team');
}

class TrackersController {
  async list(req, res) {
    const orgId = req.tenantId;
    const { status, teamId, openPositionId } = req.query;
    const trackers = await trackersService.getAllTrackers(orgId, { status, teamId, openPositionId, teamIds: visibleTeamIds(req.user) });
    res.json({ status: 'success', data: { trackers } });
  }

  async getById(req, res) {
    const orgId = req.tenantId;
    const { id } = req.params;
    await trackersService._assertTracker(orgId, id, req.user);
    const tracker = await trackersService.getTrackerById(orgId, id);
    res.json({ status: 'success', data: { tracker } });
  }

  async getSummary(req, res) {
    const orgId = req.tenantId;
    const { teamId, openPositionId } = req.query;
    const summary = await trackersService.getSummary(orgId, { teamId, openPositionId, teamIds: visibleTeamIds(req.user) });
    res.json({ status: 'success', data: { summary } });
  }

  async create(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    requireTeam(req, req.body.teamId);
    const tracker = await trackersService.createTracker(orgId, req.body, userId);
    res.status(201).json({ status: 'success', data: { tracker } });
  }

  async tag(req, res) {
    requireTeam(req, req.body.teamId);
    const result = await trackersService.tagCandidates(req.tenantId, req.body, req.user?.userId);
    res.json({ status: 'success', data: result });
  }

  async update(req, res) {
    await trackersService._assertTracker(req.tenantId, req.params.id, req.user);
    const tracker = await trackersService.updateTracker(req.tenantId, req.params.id, req.body, req.user?.userId);
    res.json({ status: 'success', data: { tracker } });
  }

  async advanceStage(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    await trackersService._assertTracker(orgId, id, req.user);
    const { nextStageId, note } = req.body;
    const log = await trackersService.advanceStage(orgId, id, nextStageId, userId, note);
    res.json({ status: 'success', data: { log } });
  }

  async block(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    const { reason } = req.body;
    await trackersService._assertTracker(orgId, id, req.user);
    const tracker = await trackersService.blockTracker(orgId, id, reason, userId);
    res.json({ status: 'success', data: { tracker } });
  }

  async hold(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    await trackersService._assertTracker(orgId, id, req.user);
    const tracker = await trackersService.holdTracker(orgId, id, userId);
    res.json({ status: 'success', data: { tracker } });
  }

  async resume(req, res) {
    await trackersService._assertTracker(req.tenantId, req.params.id, req.user);
    const tracker = await trackersService.resumeTracker(req.tenantId, req.params.id, req.user?.userId);
    res.json({ status: 'success', data: { tracker } });
  }

  async getHistory(req, res) {
    const { id } = req.params;
    await trackersService._assertTracker(req.tenantId, id, req.user);
    const history = await trackersService.getStageHistory(id);
    res.json({ status: 'success', data: { history } });
  }

  async addAction(req, res) {
    const userId = req.user?.userId;
    const { id, logId } = req.params;
    const action = await trackersService.addStageAction(req.tenantId, id, logId, req.body, userId, req.user);
    res.status(201).json({ status: 'success', data: { action } });
  }
}

module.exports = new TrackersController();
