const mailService = require('./mail.service');

class MailController {
  async compose(req, res) {
    const data = await mailService.compose(req.tenantId, req.user, req.body);
    res.json({ status: 'success', data });
  }

  async markSent(req, res) {
    const data = await mailService.markSent(req.tenantId, req.user, req.body);
    res.status(201).json({ status: 'success', data });
  }
}

module.exports = new MailController();
