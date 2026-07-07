const jobPortalService = require('./job-portal.service');

class JobPortalController {
  // Middleware to inject orgId based on orgSlug
  async resolveOrg(req, res, next) {
    try {
      const { orgSlug } = req.params;
      const org = await jobPortalService.getOrgBySlug(orgSlug);
      req.resolvedOrgId = org.id;
      req.resolvedOrg = org;
      next();
    } catch (error) {
      next(error);
    }
  }

  async getOrgProfile(req, res) {
    const org = req.resolvedOrg;
    // Don't expose sensitive info
    res.json({
      status: 'success',
      data: {
        organisation: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          logoUrl: org.logoUrl
        }
      }
    });
  }

  async listJobs(req, res) {
    const jobs = await jobPortalService.getPublicJobs(req.resolvedOrgId);
    res.json({ status: 'success', data: { jobs } });
  }

  async getJob(req, res) {
    const { jobId } = req.params;
    const job = await jobPortalService.getPublicJobDetails(req.resolvedOrgId, jobId);
    res.json({ status: 'success', data: { job } });
  }

  async apply(req, res) {
    const result = await jobPortalService.submitApplication(req.resolvedOrgId, req.body);
    res.status(201).json({ status: 'success', data: result });
  }
}

module.exports = new JobPortalController();
