const service = require('./portal.service');

class PortalController {
  async listJobs(req, res) {
    const postings = await service.getPublicJobPostings();
    res.json({
      success: true,
      data: postings,
      count: postings.length,
    });
  }

  async getJobById(req, res) {
    const { id } = req.params;
    const posting = await service.getPublicJobPostingById(id);
    res.json({ success: true, data: posting });
  }

  async register(req, res) {
    const seeker = await service.registerJobSeeker(req.body);
    res.status(201).json({ success: true, data: seeker });
  }

  async login(req, res) {
    const { email, password } = req.body;
    const result = await service.loginJobSeeker(email, password);
    res.json({ success: true, data: result });
  }

  async apply(req, res) {
    const seekerId = req.seeker.id;
    const portalApp = await service.submitPortalApplication(seekerId, req.body);
    res.status(201).json({ success: true, data: portalApp });
  }
}

module.exports = new PortalController();
