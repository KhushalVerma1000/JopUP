const service = require('./platform-admins.service');

class PlatformAdminsController {
  async list(req, res) {
    const admins = await service.list();
    res.json({ status: 'success', data: { admins } });
  }

  async create(req, res) {
    const admin = await service.create(req.tenantId, req.user.userId, req.body);
    res.status(201).json({ status: 'success', data: { admin } });
  }

  async remove(req, res) {
    const result = await service.remove(req.tenantId, req.user.userId, req.params.userId);
    res.json({ status: 'success', data: result });
  }
}

module.exports = new PlatformAdminsController();
