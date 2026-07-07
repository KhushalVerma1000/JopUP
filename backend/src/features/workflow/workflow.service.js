const { db, schema } = require('../../utils/db');
const { eq, and, asc } = require('drizzle-orm');
const { NotFoundError } = require('../../utils/errors');
const { auditWrite } = require('../../utils/audit');

class WorkflowService {
  async getTemplates(orgId, teamId) {
    const conditions = [eq(schema.workflowTemplate.organisationId, orgId)];
    if (teamId) {
      conditions.push(eq(schema.workflowTemplate.teamId, teamId));
    }
    
    return await db.select().from(schema.workflowTemplate).where(and(...conditions));
  }

  async getTemplateById(orgId, id) {
    const t = await db.query.workflowTemplate.findFirst({
      where: and(eq(schema.workflowTemplate.id, id), eq(schema.workflowTemplate.organisationId, orgId)),
      with: { stages: true }
    });
    
    if (!t) {
      throw new NotFoundError('Workflow template not found');
    }
    
    return t;
  }

  async createTemplate(orgId, data, userId) {
    const [newTemplate] = await db.insert(schema.workflowTemplate).values({
      ...data,
      organisationId: orgId,
      createdBy: userId
    }).returning();
    
    await auditWrite(orgId, userId, 'create', 'workflow_template', newTemplate.id, null, newTemplate, 'workflow');
    
    return newTemplate;
  }

  async updateTemplate(orgId, id, data, userId) {
    const oldT = await this.getTemplateById(orgId, id);
    
    if (data.isDefault) {
      // Unset previous default for the team
      await db.update(schema.workflowTemplate)
        .set({ isDefault: false })
        .where(eq(schema.workflowTemplate.teamId, oldT.teamId));
    }
    
    const [updatedT] = await db
      .update(schema.workflowTemplate)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(schema.workflowTemplate.id, id), eq(schema.workflowTemplate.organisationId, orgId)))
      .returning();
      
    await auditWrite(orgId, userId, 'update', 'workflow_template', id, oldT, updatedT, 'workflow');
    
    return updatedT;
  }

  async deleteTemplate(orgId, id) {
    const oldT = await this.getTemplateById(orgId, id);
    
    await db
      .delete(schema.workflowTemplate)
      .where(and(eq(schema.workflowTemplate.id, id), eq(schema.workflowTemplate.organisationId, orgId)));
      
    await auditWrite(orgId, null, 'delete', 'workflow_template', id, oldT, null, 'workflow');
  }

  async seedDefaultWorkflow(orgId, teamId, userId) {
    const template = await this.createTemplate(orgId, {
      name: 'Default Pipeline',
      teamId,
      description: 'Standard recruiting process',
      isDefault: true
    }, userId);
    
    const defaultStages = [
      { name: 'Applied', stageKey: 'applied', orderIndex: 10, isBlockable: true, isFinalSuccess: false },
      { name: 'Screening', stageKey: 'screening', orderIndex: 20, isBlockable: true, isFinalSuccess: false },
      { name: 'Line-up', stageKey: 'lineup', orderIndex: 30, isBlockable: true, isFinalSuccess: false },
      { name: 'Turn up', stageKey: 'turnup', orderIndex: 40, isBlockable: true, isFinalSuccess: false },
      { name: 'Interview', stageKey: 'interview', orderIndex: 50, isBlockable: true, isFinalSuccess: false },
      { name: 'Offer', stageKey: 'offer', orderIndex: 60, isBlockable: true, isFinalSuccess: false },
      { name: 'Joined', stageKey: 'joined', orderIndex: 70, isBlockable: false, isFinalSuccess: true }
    ];
    
    for (const s of defaultStages) {
      await this.createStage(template.id, s);
    }
    
    return template;
  }

  async getStages(templateId) {
    return await db.select().from(schema.workflowStage)
      .where(eq(schema.workflowStage.workflowTemplateId, templateId))
      .orderBy(asc(schema.workflowStage.orderIndex));
  }

  async createStage(templateId, data) {
    const [s] = await db.insert(schema.workflowStage).values({
      ...data,
      workflowTemplateId: templateId
    }).returning();
    
    return s;
  }

  async updateStage(templateId, stageId, data) {
    const [s] = await db
      .update(schema.workflowStage)
      .set(data)
      .where(and(eq(schema.workflowStage.id, stageId), eq(schema.workflowStage.workflowTemplateId, templateId)))
      .returning();
      
    if (!s) {
      throw new NotFoundError('Stage not found');
    }
    
    return s;
  }

  async deleteStage(templateId, stageId) {
    const [s] = await db
      .delete(schema.workflowStage)
      .where(and(eq(schema.workflowStage.id, stageId), eq(schema.workflowStage.workflowTemplateId, templateId)))
      .returning();
      
    if (!s) {
      throw new NotFoundError('Stage not found');
    }
  }
}

module.exports = new WorkflowService();
