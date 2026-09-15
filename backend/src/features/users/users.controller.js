const usersService = require('./users.service');

class UsersController {
  async list(req, res) {
    const orgId = req.tenantId;
    const { teamId, status } = req.query;
    const users = await usersService.listUsers(orgId, { teamId, status });
    res.json({
      status: 'success',
      data: { users },
    });
  }

  async getById(req, res) {
    const orgId = req.tenantId;
    const { id } = req.params;
    const user = await usersService.getUserById(orgId, id);
    res.json({
      status: 'success',
      data: { user },
    });
  }

  async update(req, res) {
    const orgId = req.tenantId;
    const actorId = req.user?.userId;
    const { id } = req.params;
    const user = await usersService.updateProfile(orgId, id, req.body, actorId);
    res.json({
      status: 'success',
      data: { user },
    });
  }

  async updateStatus(req, res) {
    const orgId = req.tenantId;
    const actorId = req.user?.userId;
    const { id } = req.params;
    const { status } = req.body;
    const user = await usersService.updateStatus(orgId, id, status, actorId);
    res.json({
      status: 'success',
      data: { user },
    });
  }

  async remove(req, res) {
    const orgId = req.tenantId;
    const actorId = req.user?.userId;
    const { id } = req.params;
    // Soft delete — see updateStatus's docstring for why this never removes
    // the row. Kept as a DELETE route too since that's what a UI's
    // "remove employee" button conventionally calls.
    const user = await usersService.updateStatus(orgId, id, 'inactive', actorId);
    res.json({
      status: 'success',
      data: { user },
    });
  }
}

module.exports = new UsersController();
