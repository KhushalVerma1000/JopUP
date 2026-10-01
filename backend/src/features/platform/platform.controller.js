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
}

module.exports = new PlatformController();
