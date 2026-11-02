const svc = require('./platform.service');

class PlatformController {
  async metrics(req, res) {
    res.json({ status: 'success', data: await svc.getMetrics() });
  }
  async listOrganisations(req, res) {
    res.json({ status: 'success', data: await svc.listOrganisations(req.query) });
  }
  async getOrganisation(req, res) {
    res.json({ status: 'success', data: await svc.getOrganisationDetail(req.params.id) });
  }
  async grantTrial(req, res) {
    res.json({ status: 'success', data: await svc.grantExtendedTrial(req.params.id, req.body.from, req.user.userId) });
  }
  async revokeTrial(req, res) {
    res.json({ status: 'success', data: await svc.revokeExtendedTrial(req.params.id, req.user.userId) });
  }
  async listSelections(req, res) {
    res.json({ status: 'success', data: { selections: await svc.listTrialSelections() } });
  }
  async addSelection(req, res) {
    res.status(201).json({ status: 'success', data: { selection: await svc.addTrialSelection(req.body.match, req.body.note, req.user.userId, req.tenantId) } });
  }
  async removeSelection(req, res) {
    await svc.removeTrialSelection(req.params.id, req.user.userId, req.tenantId);
    res.json({ status: 'success' });
  }
}

module.exports = new PlatformController();
