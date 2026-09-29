const { db, schema } = require('../../utils/db');
const { eq, and, or, sql, inArray } = require('drizzle-orm');
const { NotFoundError, ConflictError, PossibleDuplicateError } = require('../../utils/errors');
const { auditWrite } = require('../../utils/audit');
const { normalizePhone } = require('../../utils/phone');

class CandidatesService {
  async getAllCandidates(orgId, teamId) {
    if (teamId) {
      const sharedAccess = await db
        .select({ candidateId: schema.candidateTeamAccess.candidateId })
        .from(schema.candidateTeamAccess)
        .where(eq(schema.candidateTeamAccess.teamId, teamId));
        
      const sharedIds = sharedAccess.map(a => a.candidateId);
      
      const conditions = [eq(schema.candidate.ownerTeamId, teamId)];
      if (sharedIds.length > 0) {
        conditions.push(inArray(schema.candidate.id, sharedIds));
      }
      
      return await db.select().from(schema.candidate).where(
        and(
          eq(schema.candidate.organisationId, orgId),
          or(...conditions)
        )
      );
    }
    
    // Org-wide candidates
    return await db.select().from(schema.candidate).where(eq(schema.candidate.organisationId, orgId));
  }

  async getCandidateById(orgId, id) {
    const c = await db.query.candidate.findFirst({
      where: and(eq(schema.candidate.id, id), eq(schema.candidate.organisationId, orgId))
    });
    
    if (!c) {
      throw new NotFoundError('Candidate not found');
    }
    
    return c;
  }

  async createCandidate(orgId, data, userId) {
    if (data.email) {
      const existing = await db.query.candidate.findFirst({
        where: and(
          eq(schema.candidate.email, data.email),
          eq(schema.candidate.organisationId, orgId)
        )
      });
      
      if (existing) {
        throw new ConflictError('A candidate with this email already exists in this organization');
      }
    }

    // ADR-2: dedup on normalized phone alone, never phone+name (see
    // utils/phone.js). A warning, not a hard block — confirmDuplicate
    // lets the caller proceed once the user has seen the match.
    const phoneNormalized = normalizePhone(data.phone, data.phoneCountry);
    if (phoneNormalized && !data.confirmDuplicate) {
      const existingByPhone = await db.query.candidate.findFirst({
        where: and(
          eq(schema.candidate.phoneNormalized, phoneNormalized),
          eq(schema.candidate.organisationId, orgId)
        )
      });

      if (existingByPhone) {
        throw new PossibleDuplicateError(existingByPhone);
      }
    }

    const { confirmDuplicate, ...candidateData } = data;

    const [newCandidate] = await db.insert(schema.candidate).values({
      ...candidateData,
      phoneNormalized,
      organisationId: orgId,
      createdBy: userId
    }).returning();
    
    await auditWrite(orgId, userId, 'create', 'candidate', newCandidate.id, null, newCandidate, 'candidates');
    
    return newCandidate;
  }

  async updateCandidate(orgId, id, data, userId) {
    const oldCandidate = await this.getCandidateById(orgId, id);

    const updateData = { ...data };
    if ('phone' in updateData || 'phoneCountry' in updateData) {
      updateData.phoneNormalized = normalizePhone(
        updateData.phone ?? oldCandidate.phone,
        updateData.phoneCountry ?? oldCandidate.phoneCountry
      );
    }
    delete updateData.confirmDuplicate;

    const [updatedCandidate] = await db
      .update(schema.candidate)
      .set({ ...updateData, updatedBy: userId, updatedAt: new Date() })
      .where(and(eq(schema.candidate.id, id), eq(schema.candidate.organisationId, orgId)))
      .returning();
      
    await auditWrite(orgId, userId, 'update', 'candidate', id, oldCandidate, updatedCandidate, 'candidates');
    
    return updatedCandidate;
  }

  async deleteCandidate(orgId, id) {
    const oldCandidate = await this.getCandidateById(orgId, id);
    
    await db
      .delete(schema.candidate)
      .where(and(eq(schema.candidate.id, id), eq(schema.candidate.organisationId, orgId)));
      
    await auditWrite(orgId, null, 'delete', 'candidate', id, oldCandidate, null, 'candidates');
  }

  async grantTeamAccess(orgId, candidateId, teamId, grantedBy, canWrite) {
    await this.getCandidateById(orgId, candidateId);
    
    const [access] = await db.insert(schema.candidateTeamAccess).values({
      candidateId,
      teamId,
      grantedBy,
      canWrite
    }).returning();
    
    return access;
  }
}

module.exports = new CandidatesService();
