const { db, schema } = require('../../utils/db');
const { eq, and } = require('drizzle-orm');
const { NotFoundError } = require('../../utils/errors');

class TeamsService {
  async getAllTeams(orgId) {
    return await db.select().from(schema.team).where(eq(schema.team.organisationId, orgId));
  }

  async getTeamById(orgId, id) {
    const t = await db.query.team.findFirst({
      where: and(eq(schema.team.id, id), eq(schema.team.organisationId, orgId))
    });
    
    if (!t) {
      throw new NotFoundError('Team not found');
    }
    
    return t;
  }

  async createTeam(orgId, data) {
    const [newTeam] = await db.insert(schema.team).values({
      ...data,
      organisationId: orgId
    }).returning();
    
    return newTeam;
  }

  async updateTeam(orgId, id, data) {
    const [updatedTeam] = await db
      .update(schema.team)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(schema.team.id, id), eq(schema.team.organisationId, orgId)))
      .returning();
      
    if (!updatedTeam) {
      throw new NotFoundError('Team not found');
    }
    
    return updatedTeam;
  }

  async deleteTeam(orgId, id) {
    const [deletedTeam] = await db
      .delete(schema.team)
      .where(and(eq(schema.team.id, id), eq(schema.team.organisationId, orgId)))
      .returning();
      
    if (!deletedTeam) {
      throw new NotFoundError('Team not found');
    }
    
    return deletedTeam;
  }
}

module.exports = new TeamsService();
