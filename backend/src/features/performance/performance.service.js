const { db, schema } = require('../../utils/db');
const { eq, and, asc } = require('drizzle-orm');
const { NotFoundError } = require('../../utils/errors');
const { auditWrite } = require('../../utils/audit');

class PerformanceService {
  // --- KPIs ---
  async getKpiDefinitions(orgId, teamId) {
    const conditions = [eq(schema.kpiDefinition.organisationId, orgId)];
    if (teamId) conditions.push(eq(schema.kpiDefinition.teamId, teamId));
    return await db.select().from(schema.kpiDefinition).where(and(...conditions));
  }

  async createKpiDefinition(orgId, data, userId) {
    const [kpi] = await db.insert(schema.kpiDefinition).values({
      ...data,
      organisationId: orgId,
      createdBy: userId
    }).returning();
    
    await auditWrite(orgId, userId, 'create', 'kpi', kpi.id, null, kpi, 'performance');
    return kpi;
  }

  async updateKpiDefinition(orgId, id, data, userId) {
    const oldKpi = await db.query.kpiDefinition.findFirst({ where: eq(schema.kpiDefinition.id, id) });
    if (!oldKpi) throw new NotFoundError('KPI not found');
    
    const [updatedKpi] = await db.update(schema.kpiDefinition)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(schema.kpiDefinition.id, id), eq(schema.kpiDefinition.organisationId, orgId)))
      .returning();
      
    await auditWrite(orgId, userId, 'update', 'kpi', id, oldKpi, updatedKpi, 'performance');
    return updatedKpi;
  }

  async getKpiEntries(kpiId, teamId) {
    const conditions = [eq(schema.kpiEntry.kpiId, kpiId)];
    if (teamId) conditions.push(eq(schema.kpiEntry.teamId, teamId));
    
    return await db.select().from(schema.kpiEntry)
      .where(and(...conditions))
      .orderBy(asc(schema.kpiEntry.periodDate));
  }

  async createKpiEntry(data, userId) {
    const [entry] = await db.insert(schema.kpiEntry).values({
      ...data,
      recordedBy: userId
    }).returning();
    return entry;
  }

  // --- Reviews ---
  async getReviews(orgId, teamId) {
    const conditions = [eq(schema.performanceReview.organisationId, orgId)];
    if (teamId) conditions.push(eq(schema.performanceReview.teamId, teamId));
    return await db.select().from(schema.performanceReview).where(and(...conditions));
  }

  async createReview(orgId, data, userId) {
    const [review] = await db.insert(schema.performanceReview).values({
      ...data,
      organisationId: orgId,
      reviewerId: userId
    }).returning();
    
    await auditWrite(orgId, userId, 'create', 'review', review.id, null, review, 'performance');
    return review;
  }

  async updateReview(orgId, id, data, userId) {
    const oldR = await db.query.performanceReview.findFirst({ where: eq(schema.performanceReview.id, id) });
    if (!oldR) throw new NotFoundError('Review not found');
    
    const updateData = { ...data, updatedAt: new Date() };
    if (data.status === 'submitted' && oldR.status !== 'submitted') updateData.submittedAt = new Date();
    if (data.status === 'acknowledged' && oldR.status !== 'acknowledged') updateData.acknowledgedAt = new Date();

    const [updatedR] = await db.update(schema.performanceReview)
      .set(updateData)
      .where(and(eq(schema.performanceReview.id, id), eq(schema.performanceReview.organisationId, orgId)))
      .returning();
      
    await auditWrite(orgId, userId, 'update', 'review', id, oldR, updatedR, 'performance');
    return updatedR;
  }

  // --- Goals ---
  async getGoals(orgId, teamId) {
    const conditions = [eq(schema.goal.organisationId, orgId)];
    if (teamId) conditions.push(eq(schema.goal.teamId, teamId));
    return await db.select().from(schema.goal).where(and(...conditions));
  }

  async createGoal(orgId, data, userId) {
    const [goal] = await db.insert(schema.goal).values({
      ...data,
      organisationId: orgId,
      createdBy: userId
    }).returning();
    
    await auditWrite(orgId, userId, 'create', 'goal', goal.id, null, goal, 'performance');
    return goal;
  }

  async updateGoal(orgId, id, data, userId) {
    const oldG = await db.query.goal.findFirst({ where: eq(schema.goal.id, id) });
    if (!oldG) throw new NotFoundError('Goal not found');
    
    const updateData = { ...data, updatedAt: new Date() };
    if (data.status === 'completed' && oldG.status !== 'completed') updateData.completedAt = new Date();

    const [updatedG] = await db.update(schema.goal)
      .set(updateData)
      .where(and(eq(schema.goal.id, id), eq(schema.goal.organisationId, orgId)))
      .returning();
      
    await auditWrite(orgId, userId, 'update', 'goal', id, oldG, updatedG, 'performance');
    return updatedG;
  }

  // --- Strategy ---
  async getStrategies(orgId, teamId) {
    const conditions = [eq(schema.teamStrategy.organisationId, orgId)];
    if (teamId) conditions.push(eq(schema.teamStrategy.teamId, teamId));
    return await db.select().from(schema.teamStrategy).where(and(...conditions));
  }

  async createStrategy(orgId, data, userId) {
    const [strategy] = await db.insert(schema.teamStrategy).values({
      ...data,
      organisationId: orgId,
      createdBy: userId
    }).returning();
    
    await auditWrite(orgId, userId, 'create', 'strategy', strategy.id, null, strategy, 'performance');
    return strategy;
  }

  async updateStrategy(orgId, id, data, userId) {
    const oldS = await db.query.teamStrategy.findFirst({ where: eq(schema.teamStrategy.id, id) });
    if (!oldS) throw new NotFoundError('Strategy not found');
    
    const [updatedS] = await db.update(schema.teamStrategy)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(schema.teamStrategy.id, id), eq(schema.teamStrategy.organisationId, orgId)))
      .returning();
      
    await auditWrite(orgId, userId, 'update', 'strategy', id, oldS, updatedS, 'performance');
    return updatedS;
  }
}

module.exports = new PerformanceService();
