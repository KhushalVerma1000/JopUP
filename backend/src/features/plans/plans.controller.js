const plansService = require('./plans.service');

class PlansController {
  async list(req, res) {
    const plans = await plansService.getAllPlans();
    res.json({
      status: 'success',
      data: { plans }
    });
  }

  async getById(req, res) {
    const { id } = req.params;
    const plan = await plansService.getPlanById(id);
    res.json({
      status: 'success',
      data: { plan }
    });
  }

  async create(req, res) {
    const newPlan = await plansService.createPlan(req.body);
    res.status(201).json({
      status: 'success',
      data: { plan: newPlan }
    });
  }

  async update(req, res) {
    const { id } = req.params;
    const updatedPlan = await plansService.updatePlan(id, req.body);
    res.json({
      status: 'success',
      data: { plan: updatedPlan }
    });
  }
}

module.exports = new PlansController();
