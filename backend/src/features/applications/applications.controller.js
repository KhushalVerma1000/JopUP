const applicationsService = require('./applications.service');

class ApplicationsController {
  async list(req, res) {
    const orgId = req.tenantId;
    const { jobPostingId, candidateId } = req.query;
    const applications = await applicationsService.getAllApplications(orgId, { jobPostingId, candidateId });
    res.json({ status: 'success', data: { applications } });
  }

  async getById(req, res) {
    const orgId = req.tenantId;
    const { id } = req.params;
    const application = await applicationsService.getApplicationById(orgId, id);
    res.json({ status: 'success', data: { application } });
  }

  async create(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const application = await applicationsService.createApplication(orgId, req.body, userId);
    res.status(201).json({ status: 'success', data: { application } });
  }
}

module.exports = new ApplicationsController();
