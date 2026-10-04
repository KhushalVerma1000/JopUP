const openPositionsService = require('./open-positions.service');
const { visibleTeamIds, canSeeTeam } = require('../../utils/teamScope');
const { ForbiddenError, NotFoundError } = require('../../utils/errors');

// A position outside the caller's teams looks exactly like one that doesn't exist.
async function loadVisible(req) {
  const position = await openPositionsService.getOpenPositionById(req.tenantId, req.params.id);
  if (!canSeeTeam(req.user, position.teamId)) throw new NotFoundError('Open position not found');
  return position;
}

class OpenPositionsController {
  async list(req, res) {
    const orgId = req.tenantId;
    const { status, teamId, clientId } = req.query;
    const positions = await openPositionsService.getAllOpenPositions(orgId, { status, teamId, clientId, teamIds: visibleTeamIds(req.user) });
    res.json({ status: 'success', data: { positions } });
  }

  async getById(req, res) {
    const position = await loadVisible(req);
    res.json({ status: 'success', data: { position } });
  }

  async create(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    if (!canSeeTeam(req.user, req.body.teamId)) throw new ForbiddenError('You don\'t have access to that team');
    const position = await openPositionsService.createOpenPosition(orgId, req.body, userId);
    res.status(201).json({ status: 'success', data: { position } });
  }

  async update(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    await loadVisible(req);
    if (req.body.teamId && !canSeeTeam(req.user, req.body.teamId)) throw new ForbiddenError('You don\'t have access to that team');
    const position = await openPositionsService.updateOpenPosition(orgId, id, req.body, userId);
    res.json({ status: 'success', data: { position } });
  }

  async remove(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    await loadVisible(req);
    await openPositionsService.deleteOpenPosition(orgId, id, userId);
    res.status(204).send();
  }
}

module.exports = new OpenPositionsController();
