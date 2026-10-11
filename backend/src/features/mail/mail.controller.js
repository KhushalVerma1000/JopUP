const mailService = require('./mail.service');
const optionsService = require('./options.service');
const types = require('./types');

class MailController {
  async compose(req, res) {
    const data = await mailService.compose(req.tenantId, req.user, req.body);
    res.json({ status: 'success', data });
  }

  types(req, res) {
    res.json({ status: 'success', data: types.describe() });
  }

  async options(req, res) {
    const data = await optionsService.options(req.tenantId, req.user, req.query, mailService);
    res.json({ status: 'success', data });
  }

  async pending(req, res) {
    const data = await optionsService.pending(req.tenantId, req.user, mailService);
    res.json({ status: 'success', data });
  }

  async markSent(req, res) {
    const data = await mailService.markSent(req.tenantId, req.user, req.body);
    res.status(201).json({ status: 'success', data });
  }
}

module.exports = new MailController();
