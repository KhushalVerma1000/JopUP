const creditsService = require('./credits.service');

class CreditsController {
  async getBalance(req, res) {
    const orgId = req.tenantId;
    const account = await creditsService.getBalance(orgId);
    res.json({ status: 'success', data: { account } });
  }

  async listTransactions(req, res) {
    const orgId = req.tenantId;
    const { type, limit, offset } = req.query;
    const transactions = await creditsService.getTransactions(orgId, { type, limit, offset });
    res.json({ status: 'success', data: { transactions } });
  }

  async topUp(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { amount, description } = req.body;
    const transaction = await creditsService.topUp(orgId, amount, userId, description);
    res.status(201).json({ status: 'success', data: { transaction } });
  }

  async adjust(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { amount, description } = req.body;
    const transaction = await creditsService.adjustCredits(orgId, amount, userId, description);
    res.status(201).json({ status: 'success', data: { transaction } });
  }

  async listCosts(req, res) {
    const costs = await creditsService.getCosts();
    res.json({ status: 'success', data: { costs } });
  }
}

module.exports = new CreditsController();
