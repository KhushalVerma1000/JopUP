const jobPostingsService = require('./job-postings.service');

class JobPostingsController {
  async list(req, res) {
    const orgId = req.tenantId;
    const { status, teamId } = req.query;
    const jobs = await jobPostingsService.getAllJobPostings(orgId, { status, teamId });
    res.json({ status: 'success', data: { jobs } });
  }

  async getById(req, res) {
    const orgId = req.tenantId;
    const { id } = req.params;
    const job = await jobPostingsService.getJobPostingById(orgId, id);
    res.json({ status: 'success', data: { job } });
  }

  async create(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const job = await jobPostingsService.createJobPosting(orgId, req.body, userId);
    res.status(201).json({ status: 'success', data: { job } });
  }

  async update(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    const job = await jobPostingsService.updateJobPosting(orgId, id, req.body, userId);
    res.json({ status: 'success', data: { job } });
  }

  async publish(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    const job = await jobPostingsService.publishJobPosting(orgId, id, userId);
    res.json({ status: 'success', data: { job } });
  }

  async close(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    const job = await jobPostingsService.closeJobPosting(orgId, id, userId);
    res.json({ status: 'success', data: { job } });
  }

  async remove(req, res) {
    const orgId = req.tenantId;
    const { id } = req.params;
    await jobPostingsService.deleteJobPosting(orgId, id);
    res.status(204).send();
  }
}

module.exports = new JobPostingsController();
