const svc = require('./platform.service');
const requests = require('./platform.requests.service');

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
  async listRequests(req, res) {
    res.json({ status: 'success', data: { requests: await requests.list({ status: req.query.status }) } });
  }
  async approveRequest(req, res) {
    res.json({ status: 'success', data: await requests.approve(req.params.id, req.body, req.user.userId) });
  }
  async declineRequest(req, res) {
    res.json({ status: 'success', data: await requests.close(req.params.id, 'declined', req.body.note, req.user.userId) });
  }
  async contactedRequest(req, res) {
    res.json({ status: 'success', data: await requests.close(req.params.id, 'contacted', req.body.note, req.user.userId) });
  }
}

module.exports = new PlatformController();
