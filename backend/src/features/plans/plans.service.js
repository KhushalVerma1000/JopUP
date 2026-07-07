const { db, schema } = require('../../utils/db');
const { eq } = require('drizzle-orm');
const { NotFoundError } = require('../../utils/errors');

class PlansService {
  async getAllPlans() {
    return await db.select().from(schema.plan).where(eq(schema.plan.isPublic, true));
  }

  async getPlanById(id) {
    const plan = await db.query.plan.findFirst({
      where: eq(schema.plan.id, id)
    });
    
    if (!plan) {
      throw new NotFoundError('Plan not found');
    }
    
    return plan;
  }

  async createPlan(data) {
    const [newPlan] = await db.insert(schema.plan).values(data).returning();
    return newPlan;
  }

  async updatePlan(id, data) {
    const [updatedPlan] = await db
      .update(schema.plan)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.plan.id, id))
      .returning();
      
    if (!updatedPlan) {
      throw new NotFoundError('Plan not found');
    }
    
    return updatedPlan;
  }
}

module.exports = new PlansService();
