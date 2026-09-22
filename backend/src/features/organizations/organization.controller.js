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

  // Public discovery pair — see organization.service.js's docstrings for
  // why these only ever return a few safe fields. No requireAuth on either
  // (wired that way in organization.routes.js): this is what lets the
  // frontend turn a slug typed/linked pre-login into a display name and a
  // team picker, without ever showing or asking for a raw UUID.
  async getBySlug(req, res) {
    const { slug } = req.params;
    const org = await orgService.getPublicOrgBySlug(slug);
    res.json({
      status: 'success',
      data: { organization: org }
    });
  }

  async getTeamsBySlug(req, res) {
    const { slug } = req.params;
    const teams = await orgService.getPublicTeamsBySlug(slug);
    res.json({
      status: 'success',
      data: { teams }
    });
  }

  async create(req, res) {
    const { organisation: newOrg, admin } = await orgService.createOrganization(req.body);
    res.status(201).json({
      status: 'success',
      message: admin
        ? 'Organisation and admin account created. Log in via POST /api/v1/auth/login.'
        : 'Organisation created. It has no admin yet — see adminEmail/adminPassword fields, or invite one via the platform team.',
      // 'organization' kept as the top-level key (not nested under a new
      // wrapper) so this stays backward-compatible with existing callers.
      data: { organization: newOrg, admin }
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
  
  // Self-service trio for /organizations/me — any authenticated staff member
  // can view their own org's profile/modules; only org_admin can update it
  // (enforced at the route level via requireOrgRole, not here).
  async getMine(req, res) {
    const org = await orgService.getOrganizationById(req.tenantId);
    res.json({
      status: 'success',
      data: { organization: org }
    });
  }

  async updateMine(req, res) {
    const updatedOrg = await orgService.updateOrganization(req.tenantId, req.body);
    res.json({
      status: 'success',
      data: { organization: updatedOrg }
    });
  }

  async getMyModules(req, res) {
    const modules = await orgService.getOrgModules(req.tenantId);
    res.json({
      status: 'success',
      data: { modules }
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
