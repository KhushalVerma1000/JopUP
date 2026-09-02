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
}

module.exports = new AuthController();
