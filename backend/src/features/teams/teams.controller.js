const teamsService = require('./teams.service');

class TeamsController {
  async list(req, res) {
    const orgId = req.tenantId;
    const teams = await teamsService.getAllTeams(orgId);
    res.json({
      status: 'success',
      data: { teams }
    });
  }

  async getById(req, res) {
    const orgId = req.tenantId;
    const { id } = req.params;
    const team = await teamsService.getTeamById(orgId, id);
    res.json({
      status: 'success',
      data: { team }
    });
  }

  async create(req, res) {
    const orgId = req.tenantId;
    const newTeam = await teamsService.createTeam(orgId, req.body);
    res.status(201).json({
      status: 'success',
      data: { team: newTeam }
    });
  }

  async update(req, res) {
    const orgId = req.tenantId;
    const { id } = req.params;
    const updatedTeam = await teamsService.updateTeam(orgId, id, req.body);
    res.json({
      status: 'success',
      data: { team: updatedTeam }
    });
  }

  async remove(req, res) {
    const orgId = req.tenantId;
    const { id } = req.params;
    await teamsService.deleteTeam(orgId, id);
    res.status(204).send();
  }
}

module.exports = new TeamsController();
