const openPositionsService = require('./open-positions.service');

class OpenPositionsController {
  async list(req, res) {
    const orgId = req.tenantId;
    const { status, teamId, clientId } = req.query;
    const positions = await openPositionsService.getAllOpenPositions(orgId, { status, teamId, clientId });
    res.json({ status: 'success', data: { positions } });
  }

  async getById(req, res) {
    const orgId = req.tenantId;
    const { id } = req.params;
    const position = await openPositionsService.getOpenPositionById(orgId, id);
    res.json({ status: 'success', data: { position } });
  }

  async create(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const position = await openPositionsService.createOpenPosition(orgId, req.body, userId);
    res.status(201).json({ status: 'success', data: { position } });
  }

  async update(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    const position = await openPositionsService.updateOpenPosition(orgId, id, req.body, userId);
    res.json({ status: 'success', data: { position } });
  }

  async remove(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    await openPositionsService.deleteOpenPosition(orgId, id, userId);
    res.status(204).send();
  }
}

module.exports = new OpenPositionsController();
