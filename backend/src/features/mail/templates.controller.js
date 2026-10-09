const svc = require('./templates.service');
const ok = (res, data, code = 200) => res.status(code).json({ status: 'success', data });

class MailTemplatesController {
  async catalogue(req, res) { ok(res, svc.catalogue()); }
  async list(req, res) { ok(res, await svc.list(req.tenantId, req.user)); }
  async get(req, res) { ok(res, await svc.get(req.tenantId, req.user, req.params.id)); }
  async create(req, res) { ok(res, await svc.create(req.tenantId, req.user, req.body), 201); }
  async update(req, res) { ok(res, await svc.update(req.tenantId, req.user, req.params.id, req.body)); }
  async remove(req, res) { await svc.remove(req.tenantId, req.user, req.params.id); res.status(204).end(); }
}

module.exports = new MailTemplatesController();
