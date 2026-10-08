const mailService = require('./mail.service');

class MailController {
  async compose(req, res) {
    const data = await mailService.compose(req.tenantId, req.user, req.body);
    res.json({ status: 'success', data });
  }
}

module.exports = new MailController();
