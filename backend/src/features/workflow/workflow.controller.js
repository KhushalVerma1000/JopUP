const workflowService = require('./workflow.service');

class WorkflowController {
  async listTemplates(req, res) {
    const orgId = req.tenantId;
    const teamId = req.query.teamId;
    const templates = await workflowService.getTemplates(orgId, teamId);
    res.json({ status: 'success', data: { templates } });
  }

  async getTemplate(req, res) {
    const orgId = req.tenantId;
    const { id } = req.params;
    const template = await workflowService.getTemplateById(orgId, id);
    res.json({ status: 'success', data: { template } });
  }

  async createTemplate(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const newTemplate = await workflowService.createTemplate(orgId, req.body, userId);
    res.status(201).json({ status: 'success', data: { template: newTemplate } });
  }

  async updateTemplate(req, res) {
    const orgId = req.tenantId;
    const userId = req.user?.userId;
    const { id } = req.params;
    const updatedTemplate = await workflowService.updateTemplate(orgId, id, req.body, userId);
    res.json({ status: 'success', data: { template: updatedTemplate } });
  }

  async deleteTemplate(req, res) {
    const orgId = req.tenantId;
    const { id } = req.params;
    await workflowService.deleteTemplate(orgId, id);
    res.status(204).send();
  }

  async listStages(req, res) {
    const { templateId } = req.params;
    const stages = await workflowService.getStages(templateId);
    res.json({ status: 'success', data: { stages } });
  }

  async createStage(req, res) {
    const { templateId } = req.params;
    const stage = await workflowService.createStage(templateId, req.body);
    res.status(201).json({ status: 'success', data: { stage } });
  }

  async updateStage(req, res) {
    const { templateId, stageId } = req.params;
    const stage = await workflowService.updateStage(templateId, stageId, req.body);
    res.json({ status: 'success', data: { stage } });
  }

  async deleteStage(req, res) {
    const { templateId, stageId } = req.params;
    await workflowService.deleteStage(templateId, stageId);
    res.status(204).send();
  }
}

module.exports = new WorkflowController();
