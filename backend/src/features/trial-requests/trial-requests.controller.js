const svc = require('./trial-requests.service');

class TrialRequestsController {
  async create(req, res) {
    const data = await svc.create(req.body);
    // 201 even for a duplicate or a honeypot hit: the caller learns nothing it can probe.
    res.status(201).json({ status: 'success', data: { received: data.received } });
  }
}

module.exports = new TrialRequestsController();
