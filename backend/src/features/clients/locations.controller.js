const svc = require('./locations.service');
const ok = (res, data, code = 200) => res.status(code).json({ status: 'success', data });
const ctx = (req) => [req.tenantId, req.user?.userId];

class LocationsController {
  async profile(req, res) { ok(res, await svc.profile(req.tenantId, req.user, req.params.id)); }
  async createLocation(req, res) { ok(res, await svc.createLocation(...ctx(req), req.params.id, req.body), 201); }
  async updateLocation(req, res) { ok(res, await svc.updateLocation(...ctx(req), req.params.id, req.params.locationId, req.body)); }
  async removeLocation(req, res) { await svc.removeLocation(...ctx(req), req.params.id, req.params.locationId); res.status(204).end(); }
  async createContact(req, res) { ok(res, await svc.createContact(...ctx(req), req.params.id, req.body), 201); }
  async updateContact(req, res) { ok(res, await svc.updateContact(...ctx(req), req.params.id, req.params.contactId, req.body)); }
  async removeContact(req, res) { await svc.removeContact(...ctx(req), req.params.id, req.params.contactId); res.status(204).end(); }
  async mailLog(req, res) { ok(res, await svc.mailLog(req.tenantId, req.params.id)); }
}

module.exports = new LocationsController();
