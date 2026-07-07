const { db, schema } = require('../../utils/db');
const { eq } = require('drizzle-orm');
const { NotFoundError } = require('../../utils/errors');

class OrganizationService {
  async getAllOrganizations() {
    return await db.select().from(schema.organisation);
  }

  async getOrganizationById(id) {
    const org = await db.query.organisation.findFirst({
      where: eq(schema.organisation.id, id),
      with: { plan: true }
    });
    
    if (!org) {
      throw new NotFoundError('Organization not found');
    }
    
    return org;
  }

  async createOrganization(data) {
    return await db.transaction(async (tx) => {
      const [newOrg] = await tx.insert(schema.organisation).values(data).returning();
      
      // Also create a credit account for it
      await tx.insert(schema.creditAccount).values({
        organisationId: newOrg.id,
        balance: 0,
        lifetimeEarned: 0,
        lifetimeSpent: 0
      });
      
      return newOrg;
    });
  }

  async updateOrganization(id, data) {
    const [updatedOrg] = await db
      .update(schema.organisation)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.organisation.id, id))
      .returning();
      
    if (!updatedOrg) {
      throw new NotFoundError('Organization not found');
    }
    
    return updatedOrg;
  }

  async getOrgModules(orgId) {
    const org = await db.query.organisation.findFirst({
      where: eq(schema.organisation.id, orgId),
      with: { plan: true }
    });

    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    const planModules = new Set(org.plan?.modules || []);
    
    const overrides = await db
      .select()
      .from(schema.orgModuleOverride)
      .where(eq(schema.orgModuleOverride.organisationId, orgId));
      
    for (const override of overrides) {
      if (override.enabled) {
        planModules.add(override.moduleKey);
      } else {
        planModules.delete(override.moduleKey);
      }
    }
    
    return Array.from(planModules);
  }
}

module.exports = new OrganizationService();
