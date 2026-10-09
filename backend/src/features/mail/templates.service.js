const { db, schema } = require('../../utils/db');
const { and, eq, inArray, isNull, or, asc } = require('drizzle-orm');
const { NotFoundError, ForbiddenError, BadRequestError } = require('../../utils/errors');
const { visibleTeamIds, teamsWithPermission } = require('../../utils/teamScope');
const { auditWrite } = require('../../utils/audit');
const { describeCatalogue } = require('./columns');

const T = () => schema.trackerTemplate;
const canWriteFor = (user, teamId) => {
  const ids = teamsWithPermission(user, 'tracker_templates', 'write');
  // Org-wide templates (teamId null) need an org-wide grant, not just a team one.
  return teamId ? ids === null || ids.includes(teamId) : ids === null;
};

/**
 * Tracker templates = which columns a client tracker mail shows. Managers
 * define them; HR only picks one and toggles columns per send (that toggle is
 * never saved back here).
 */
class MailTemplatesService {
  catalogue() { return describeCatalogue(); }

  async list(orgId, user) {
    const teamIds = visibleTeamIds(user);
    const scope = Array.isArray(teamIds)
      ? or(isNull(T().teamId), teamIds.length ? inArray(T().teamId, teamIds) : isNull(T().teamId))
      : undefined;
    const where = scope ? and(eq(T().organisationId, orgId), scope) : eq(T().organisationId, orgId);
    return db.select().from(T()).where(where).orderBy(asc(T().name));
  }

  /** Same visibility as list(): a template from another team looks like it does not exist. */
  async get(orgId, user, id) {
    const [row] = await db.select().from(T()).where(and(eq(T().organisationId, orgId), eq(T().id, id)));
    const teamIds = visibleTeamIds(user);
    if (!row || (row.teamId && Array.isArray(teamIds) && !teamIds.includes(row.teamId))) throw new NotFoundError('Template not found');
    return row;
  }

  async create(orgId, user, data) {
    const teamId = data.teamId || null;
    if (!canWriteFor(user, teamId)) throw new ForbiddenError(teamId ? 'You cannot manage templates for that team' : 'Only an organisation admin can create organisation-wide templates');
    if (teamId) {
      const [team] = await db.select({ id: schema.team.id }).from(schema.team).where(and(eq(schema.team.id, teamId), eq(schema.team.organisationId, orgId)));
      if (!team) throw new BadRequestError('Team not found');
    }
    return db.transaction(async (tx) => {
      if (data.isDefault) await this._clearDefault(tx, orgId, teamId, data.trackerType);
      const [row] = await tx.insert(T()).values({ organisationId: orgId, teamId, createdBy: user.userId, name: data.name, trackerType: data.trackerType, columns: data.columns, isDefault: data.isDefault }).returning();
      await auditWrite(orgId, user.userId, 'create', 'tracker_template', row.id, null, row, 'mail');
      return row;
    });
  }

  async update(orgId, user, id, patch) {
    const before = await this.get(orgId, user, id);
    if (!canWriteFor(user, before.teamId)) throw new ForbiddenError('You cannot change that template');
    return db.transaction(async (tx) => {
      const type = patch.trackerType || before.trackerType;
      if (patch.isDefault) await this._clearDefault(tx, orgId, before.teamId, type);
      const [row] = await tx.update(T()).set({ ...patch, updatedAt: new Date() }).where(and(eq(T().id, id), eq(T().organisationId, orgId))).returning();
      await auditWrite(orgId, user.userId, 'update', 'tracker_template', id, before, row, 'mail');
      return row;
    });
  }

  async remove(orgId, user, id) {
    const before = await this.get(orgId, user, id);
    if (!canWriteFor(user, before.teamId)) throw new ForbiddenError('You cannot delete that template');
    try {
      await db.delete(T()).where(and(eq(T().id, id), eq(T().organisationId, orgId)));
    } catch (err) {
      // Trackers that were already generated point at their template.
      if ((err?.code || err?.cause?.code) === '23503') throw new BadRequestError('This template was used for trackers that were already sent, so it cannot be deleted');
      throw err;
    }
    await auditWrite(orgId, user.userId, 'delete', 'tracker_template', id, before, null, 'mail');
  }

  // One default per (scope, type): choosing a new one demotes the old.
  async _clearDefault(tx, orgId, teamId, trackerType) {
    await tx.update(T()).set({ isDefault: false }).where(and(eq(T().organisationId, orgId), teamId ? eq(T().teamId, teamId) : isNull(T().teamId), eq(T().trackerType, trackerType), eq(T().isDefault, true)));
  }
}

module.exports = new MailTemplatesService();
