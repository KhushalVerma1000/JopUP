const { db, schema } = require('../../utils/db');
const { and, eq, inArray, desc } = require('drizzle-orm');
const { NotFoundError, BadRequestError } = require('../../utils/errors');
const { auditWrite } = require('../../utils/audit');
const clientsService = require('./clients.service');
const trackersService = require('../trackers/trackers.service');
const { matchLocation } = require('../mail/locationMatch');
const { visibleTeamIds } = require('../../utils/teamScope');

const L = () => schema.clientLocation;
const S = () => schema.clientSpoc;

/**
 * A client's mail profile: its locations (with the spellings that map to
 * them), each location's contacts (To / CC) and tracker template.
 */
class LocationsService {
  async _ownLocation(orgId, clientId, locationId) {
    const [row] = await db.select().from(L()).where(and(eq(L().id, locationId), eq(L().clientId, clientId), eq(L().organisationId, orgId)));
    if (!row) throw new NotFoundError('Location not found');
    return row;
  }

  async _checkTemplate(orgId, templateId) {
    if (!templateId) return;
    const [t] = await db.select({ id: schema.trackerTemplate.id }).from(schema.trackerTemplate)
      .where(and(eq(schema.trackerTemplate.id, templateId), eq(schema.trackerTemplate.organisationId, orgId)));
    if (!t) throw new BadRequestError('Template not found');
  }

  async _checkLocation(orgId, clientId, locationId) {
    if (locationId) await this._ownLocation(orgId, clientId, locationId);
  }

  /** The profile screen: locations + contacts + the client-wide contacts + candidates that fit no location. */
  async profile(orgId, user, clientId) {
    await clientsService.getClientById(orgId, clientId);
    const locations = await db.select().from(L()).where(and(eq(L().clientId, clientId), eq(L().organisationId, orgId))).orderBy(L().name);
    const contacts = await db.select().from(S()).where(and(eq(S().clientId, clientId), eq(S().organisationId, orgId))).orderBy(S().name);
    const templateIds = [...new Set(locations.map((l) => l.trackerTemplateId).filter(Boolean))];
    const templates = templateIds.length
      ? await db.select({ id: schema.trackerTemplate.id, name: schema.trackerTemplate.name }).from(schema.trackerTemplate).where(inArray(schema.trackerTemplate.id, templateIds))
      : [];
    const tplName = new Map(templates.map((t) => [t.id, t.name]));

    return {
      locations: locations.map((l) => ({
        ...l,
        trackerTemplateName: l.trackerTemplateId ? tplName.get(l.trackerTemplateId) || null : null,
        contacts: contacts.filter((c) => c.locationId === l.id),
      })),
      clientContacts: contacts.filter((c) => !c.locationId),
      unmatched: await this._unmatched(orgId, user, clientId, locations),
    };
  }

  /** Live candidates of this client whose location fits none of the client's locations. */
  async _unmatched(orgId, user, clientId, locations) {
    const teamIds = visibleTeamIds(user);
    const trackers = await trackersService.getAllTrackers(orgId, { status: 'active', teamIds });
    const live = trackers.filter((t) => t.clientId === clientId && ['active', 'on_hold'].includes(t.status));
    const bad = live.filter((t) => !matchLocation(t.candidateLocation, locations));
    const names = [...new Set(bad.map((t) => (t.candidateLocation || '').trim() || '(no location)'))];
    return { count: bad.length, locations: names.slice(0, 20) };
  }

  async createLocation(orgId, userId, clientId, data) {
    await clientsService.getClientById(orgId, clientId);
    await this._checkTemplate(orgId, data.trackerTemplateId);
    const existing = await db.select({ name: L().name }).from(L()).where(eq(L().clientId, clientId));
    if (existing.some((e) => e.name.toLowerCase() === data.name.toLowerCase())) throw new BadRequestError('This client already has a location with that name');
    const [row] = await db.insert(L()).values({ organisationId: orgId, clientId, createdBy: userId, name: data.name, aliases: data.aliases, trackerTemplateId: data.trackerTemplateId || null }).returning();
    await auditWrite(orgId, userId, 'create', 'client_location', row.id, null, row, 'clients');
    return row;
  }

  async updateLocation(orgId, userId, clientId, locationId, patch) {
    const before = await this._ownLocation(orgId, clientId, locationId);
    if (patch.trackerTemplateId !== undefined) await this._checkTemplate(orgId, patch.trackerTemplateId);
    if (patch.name) {
      const others = await db.select({ id: L().id, name: L().name }).from(L()).where(eq(L().clientId, clientId));
      if (others.some((o) => o.id !== locationId && o.name.toLowerCase() === patch.name.toLowerCase())) throw new BadRequestError('This client already has a location with that name');
    }
    const [row] = await db.update(L()).set({ ...patch, updatedAt: new Date() }).where(and(eq(L().id, locationId), eq(L().organisationId, orgId))).returning();
    await auditWrite(orgId, userId, 'update', 'client_location', locationId, before, row, 'clients');
    return row;
  }

  async removeLocation(orgId, userId, clientId, locationId) {
    const before = await this._ownLocation(orgId, clientId, locationId);
    // Its contacts stay (client-wide) rather than vanish; their location link is cleared by the FK.
    await db.delete(L()).where(and(eq(L().id, locationId), eq(L().organisationId, orgId)));
    await auditWrite(orgId, userId, 'delete', 'client_location', locationId, before, null, 'clients');
  }

  async createContact(orgId, userId, clientId, data) {
    await clientsService.getClientById(orgId, clientId);
    await this._checkLocation(orgId, clientId, data.locationId);
    const [row] = await db.insert(S()).values({ organisationId: orgId, clientId, createdBy: userId, ...data, locationId: data.locationId || null }).returning();
    await auditWrite(orgId, userId, 'create', 'client_spoc', row.id, null, row, 'clients');
    return row;
  }

  async _ownContact(orgId, clientId, contactId) {
    const [row] = await db.select().from(S()).where(and(eq(S().id, contactId), eq(S().clientId, clientId), eq(S().organisationId, orgId)));
    if (!row) throw new NotFoundError('Contact not found');
    return row;
  }

  async updateContact(orgId, userId, clientId, contactId, patch) {
    const before = await this._ownContact(orgId, clientId, contactId);
    if (patch.locationId !== undefined) await this._checkLocation(orgId, clientId, patch.locationId);
    const [row] = await db.update(S()).set({ ...patch, updatedAt: new Date() }).where(and(eq(S().id, contactId), eq(S().organisationId, orgId))).returning();
    await auditWrite(orgId, userId, 'update', 'client_spoc', contactId, before, row, 'clients');
    return row;
  }

  async removeContact(orgId, userId, clientId, contactId) {
    const before = await this._ownContact(orgId, clientId, contactId);
    await db.delete(S()).where(and(eq(S().id, contactId), eq(S().organisationId, orgId)));
    await auditWrite(orgId, userId, 'delete', 'client_spoc', contactId, before, null, 'clients');
  }

  async mailLog(orgId, clientId) {
    await clientsService.getClientById(orgId, clientId);
    const M = schema.clientMailLog;
    const rows = await db.select().from(M).where(and(eq(M.clientId, clientId), eq(M.organisationId, orgId))).orderBy(desc(M.sentAt)).limit(100);
    const userIds = [...new Set(rows.map((r) => r.sentBy))];
    const users = userIds.length ? await db.select({ id: schema.user.id, firstName: schema.user.firstName, lastName: schema.user.lastName }).from(schema.user).where(inArray(schema.user.id, userIds)) : [];
    const byId = new Map(users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ')]));
    return rows.map((r) => ({ ...r, sentByName: byId.get(r.sentBy) || null }));
  }
}

module.exports = new LocationsService();
