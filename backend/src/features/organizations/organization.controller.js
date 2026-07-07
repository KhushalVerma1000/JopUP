const orgService = require('./organization.service');

class OrganizationController {
  async list(req, res) {
    const orgs = await orgService.getAllOrganizations();
    res.json({
      status: 'success',
      data: { organizations: orgs }
    });
  }

  async getById(req, res) {
    const { id } = req.params;
    const org = await orgService.getOrganizationById(id);
    res.json({
      status: 'success',
      data: { organization: org }
    });
  }

  async create(req, res) {
    const newOrg = await orgService.createOrganization(req.body);
    res.status(201).json({
      status: 'success',
      data: { organization: newOrg }
    });
  }

  async update(req, res) {
    const { id } = req.params;
    const updatedOrg = await orgService.updateOrganization(id, req.body);
    res.json({
      status: 'success',
      data: { organization: updatedOrg }
    });
  }
  
  async getModules(req, res) {
    const { id } = req.params;
    const modules = await orgService.getOrgModules(id);
    res.json({
      status: 'success',
      data: { modules }
    });
  }
}

module.exports = new OrganizationController();
