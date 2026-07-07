const { db, schema } = require('../../utils/db');
const { eq, and, or, sql, inArray } = require('drizzle-orm');
const { NotFoundError } = require('../../utils/errors');
const { auditWrite } = require('../../utils/audit');

class ClientsService {
  async getAllClients(orgId, teamId) {
    if (teamId) {
      // Find clients owned by team, or shared org-wide, or specifically shared with team
      const sharedAccess = await db
        .select({ clientId: schema.clientTeamAccess.clientId })
        .from(schema.clientTeamAccess)
        .where(eq(schema.clientTeamAccess.teamId, teamId));
        
      const sharedIds = sharedAccess.map(a => a.clientId);
      
      const conditions = [
        eq(schema.client.ownerTeamId, teamId),
        eq(schema.client.sharedOrgWide, true)
      ];
      
      if (sharedIds.length > 0) {
        conditions.push(inArray(schema.client.id, sharedIds));
      }
      
      return await db.select().from(schema.client).where(
        and(
          eq(schema.client.organisationId, orgId),
          or(...conditions)
        )
      );
    }
    
    // Org admin view - all clients in org
    return await db.select().from(schema.client).where(eq(schema.client.organisationId, orgId));
  }

  async getClientById(orgId, id) {
    const c = await db.query.client.findFirst({
      where: and(eq(schema.client.id, id), eq(schema.client.organisationId, orgId))
    });
    
    if (!c) {
      throw new NotFoundError('Client not found');
    }
    
    return c;
  }

  async createClient(orgId, data, userId) {
    const [newClient] = await db.insert(schema.client).values({
      ...data,
      organisationId: orgId,
      createdBy: userId
    }).returning();
    
    await auditWrite(orgId, userId, 'create', 'client', newClient.id, null, newClient, 'clients');
    
    return newClient;
  }

  async updateClient(orgId, id, data, userId) {
    const oldClient = await this.getClientById(orgId, id);
    
    const [updatedClient] = await db
      .update(schema.client)
      .set({ ...data, updatedBy: userId, updatedAt: new Date() })
      .where(and(eq(schema.client.id, id), eq(schema.client.organisationId, orgId)))
      .returning();
      
    await auditWrite(orgId, userId, 'update', 'client', id, oldClient, updatedClient, 'clients');
    
    return updatedClient;
  }

  async deleteClient(orgId, id) {
    const oldClient = await this.getClientById(orgId, id);
    
    await db
      .delete(schema.client)
      .where(and(eq(schema.client.id, id), eq(schema.client.organisationId, orgId)));
      
    await auditWrite(orgId, null, 'delete', 'client', id, oldClient, null, 'clients');
  }

  async shareClient(orgId, clientId, teamId, grantedBy, canWrite) {
    // Verify client exists in org
    await this.getClientById(orgId, clientId);
    
    const [access] = await db.insert(schema.clientTeamAccess).values({
      clientId,
      teamId,
      grantedBy,
      canWrite
    }).returning();
    
    return access;
  }
}

module.exports = new ClientsService();
