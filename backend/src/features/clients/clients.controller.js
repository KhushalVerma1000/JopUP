const clientsService = require('./clients.service');

class ClientsController {
  async list(req, res) {
    const orgId = req.tenantId;
    const teamId = req.query.teamId; // Optional filter
    const clients = await clientsService.getAllClients(orgId, teamId);
    res.json({
      status: 'success',
      data: { clients }
    });
  }

  async getById(req, res) {
    const orgId = req.tenantId;
    const { id } = req.params;
    const client = await clientsService.getClientById(orgId, id);
    res.json({
      status: 'success',
      data: { client }
    });
  }

  async create(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const newClient = await clientsService.createClient(orgId, req.body, userId);
    res.status(201).json({
      status: 'success',
      data: { client: newClient }
    });
  }

  async update(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    const updatedClient = await clientsService.updateClient(orgId, id, req.body, userId);
    res.json({
      status: 'success',
      data: { client: updatedClient }
    });
  }

  async remove(req, res) {
    const orgId = req.tenantId;
    const { id } = req.params;
    await clientsService.deleteClient(orgId, id);
    res.status(204).send();
  }
  
  async share(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    const { teamId, canWrite } = req.body;
    
    const access = await clientsService.shareClient(orgId, id, teamId, userId, canWrite);
    res.status(201).json({
      status: 'success',
      data: { access }
    });
  }
}

module.exports = new ClientsController();
