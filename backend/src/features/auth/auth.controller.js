const authService = require('./auth.service');

class AuthController {
  async registerStaff(req, res) {
    const user = await authService.registerStaff(req.body);
    res.status(201).json({
      status: 'success',
      message: 'Registration received. A manager or organisation admin must approve your account before you can log in.',
      data: { user },
    });
  }

  async login(req, res) {
    const { organisationSlug, email, password } = req.body;
    const { token, user, roles } = await authService.login(organisationSlug, email, password);
    res.json({
      status: 'success',
      data: { token, user, roles },
    });
  }

  async listPendingApprovals(req, res) {
    const { teamId } = req.query;
    const users = await authService.listPendingApprovals(req.tenantId, req.user.userId, teamId);
    res.json({
      status: 'success',
      data: { pendingUsers: users },
    });
  }

  async approve(req, res) {
    const { userId } = req.params;
    const user = await authService.approveStaff(req.tenantId, userId, req.user.userId);
    res.json({
      status: 'success',
      data: { user },
    });
  }

  async reject(req, res) {
    const { userId } = req.params;
    const { reason } = req.body;
    const user = await authService.rejectStaff(req.tenantId, userId, req.user.userId, reason);
    res.json({
      status: 'success',
      data: { user },
    });
  }
}

module.exports = new AuthController();
