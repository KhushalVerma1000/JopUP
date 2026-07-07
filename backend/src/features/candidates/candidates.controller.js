const candidatesService = require('./candidates.service');

class CandidatesController {
  async list(req, res) {
    const orgId = req.tenantId;
    const teamId = req.query.teamId; // Optional filter
    const candidates = await candidatesService.getAllCandidates(orgId, teamId);
    res.json({
      status: 'success',
      data: { candidates }
    });
  }

  async getById(req, res) {
    const orgId = req.tenantId;
    const { id } = req.params;
    const candidate = await candidatesService.getCandidateById(orgId, id);
    res.json({
      status: 'success',
      data: { candidate }
    });
  }

  async create(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const newCandidate = await candidatesService.createCandidate(orgId, req.body, userId);
    res.status(201).json({
      status: 'success',
      data: { candidate: newCandidate }
    });
  }

  async update(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    const updatedCandidate = await candidatesService.updateCandidate(orgId, id, req.body, userId);
    res.json({
      status: 'success',
      data: { candidate: updatedCandidate }
    });
  }

  async remove(req, res) {
    const orgId = req.tenantId;
    const { id } = req.params;
    await candidatesService.deleteCandidate(orgId, id);
    res.status(204).send();
  }

  async grantAccess(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    const { teamId, canWrite } = req.body;
    
    const access = await candidatesService.grantTeamAccess(orgId, id, teamId, userId, canWrite);
    res.status(201).json({
      status: 'success',
      data: { access }
    });
  }
}

module.exports = new CandidatesController();
