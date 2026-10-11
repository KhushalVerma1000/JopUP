const { db, schema } = require('../../utils/db');
const { and, eq, inArray, gte } = require('drizzle-orm');
const { visibleTeamIds } = require('../../utils/teamScope');
const trackersService = require('../trackers/trackers.service');
const { matchLocation } = require('./locationMatch');
const { localDate, addDays } = require('../../utils/zonedTime');
const types = require('./types');
const { BadRequestError } = require('../../utils/errors');

const OTHER = 'other'; // candidates whose location fits none of the client's hiring locations
const ALL = 'all';     // every location of the client, one mail each

/**
 * Pure: given the enriched trackers, work out what each picker step offers.
 * Kept free of the database so the rules (and the "never cross clients" rule)
 * can be tested directly.
 */
function buildOptions({ type, trackers, profiles, clientId, locationId, date, tz }) {
  const eligible = trackers.filter((t) => {
    if (!type.statuses.includes(t.status)) return false;
    if (type.stages && !type.stages.includes(t.currentStage?.stageKey)) return false;
    return !!t.clientId; // client mails are about a client's candidates; internal hires have no one to mail
  });

  // Step 1: clients
  const byClient = new Map();
  for (const t of eligible) {
    if (!byClient.has(t.clientId)) byClient.set(t.clientId, { id: t.clientId, name: t.clientName || 'Client', count: 0 });
    byClient.get(t.clientId).count += 1;
  }
  const out = { type: type.key, clients: [...byClient.values()].sort((a, b) => a.name.localeCompare(b.name)), locations: [], dates: [], undated: 0, trackerIds: [] };
  if (!clientId) return out;

  // Step 2: the client's hiring locations (only ones that have candidates for this mail)
  const mine = eligible.filter((t) => t.clientId === clientId);
  const locs = profiles.get(clientId)?.locations || [];
  const placeOf = (t) => matchLocation(t.candidateLocation, locs) || OTHER;
  const byLoc = new Map();
  for (const t of mine) byLoc.set(placeOf(t), (byLoc.get(placeOf(t)) || 0) + 1);
  const named = locs.filter((l) => byLoc.has(l.id)).map((l) => ({ id: l.id, name: l.name, count: byLoc.get(l.id) }));
  out.locations = [
    ...named,
    ...(byLoc.has(OTHER) ? [{ id: OTHER, name: locs.length ? 'Other locations' : 'No hiring location set up', count: byLoc.get(OTHER), unmatched: true }] : []),
  ];
  if (out.locations.length > 1) out.locations.unshift({ id: ALL, name: 'All locations', count: mine.length });
  if (!locationId) return out;

  const inLocation = locationId === ALL ? mine : mine.filter((t) => placeOf(t) === locationId);

  // Step 3: dates, only for mails that are about a day
  if (type.dateField) {
    const dated = inLocation.filter((t) => t[type.dateField]);
    out.undated = inLocation.length - dated.length;
    const byDay = new Map();
    for (const t of dated) { const d = localDate(new Date(t[type.dateField]), tz); byDay.set(d, (byDay.get(d) || 0) + 1); }
    out.dates = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, count]) => ({ date: d, count }));
    if (!date) return out;
    out.trackerIds = dated.filter((t) => localDate(new Date(t[type.dateField]), tz) === date).map((t) => t.id);
    return out;
  }
  out.trackerIds = inLocation.map((t) => t.id);
  return out;
}


/**
 * Pure: the day-based mails still to send. One item per (mail type, client, hiring location, day)
 * from today on, each marked sent / partly sent / not sent from the sent log. "Partly" means
 * someone was added after the mail went out, so HR knows a follow-up is due.
 */
function buildPending({ trackers, profiles, logs, tz, today, until }) {
  const groups = new Map();
  for (const type of types.TYPES.filter((t) => t.dateField)) {
    for (const t of trackers) {
      if (!t.clientId || !type.statuses.includes(t.status) || !t[type.dateField]) continue;
      if (type.stages && !type.stages.includes(t.currentStage?.stageKey)) continue;
      const day = localDate(new Date(t[type.dateField]), tz);
      if (day < today || day > until) continue;
      const locs = profiles.get(t.clientId)?.locations || [];
      const locId = matchLocation(t.candidateLocation, locs) || OTHER;
      const key = [type.key, t.clientId, locId, day].join('|');
      if (!groups.has(key)) groups.set(key, { type: type.key, typeLabel: type.label, clientId: t.clientId, clientName: t.clientName || 'Client', locationId: locId, locationName: locs.find((l) => l.id === locId)?.name || (locs.length ? 'Other locations' : 'No hiring location set up'), date: day, ids: [] });
      groups.get(key).ids.push(t.id);
    }
  }
  return [...groups.values()].map((g) => {
    const mine = logs.filter((l) => l.clientId === g.clientId && (l.locationId || OTHER) === g.locationId && l.mailType === g.type);
    const covered = new Set(mine.flatMap((l) => l.trackerIds || []));
    const sentIds = g.ids.filter((id) => covered.has(id));
    const last = mine.filter((l) => (l.trackerIds || []).some((id) => g.ids.includes(id))).sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))[0];
    const { ids, ...rest } = g;
    return { ...rest, count: ids.length, unsent: ids.length - sentIds.length, sent: sentIds.length === ids.length, partlySent: sentIds.length > 0 && sentIds.length < ids.length, lastSent: last ? { at: last.sentAt, by: last.first || null } : null };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.clientName.localeCompare(b.clientName) || a.locationName.localeCompare(b.locationName) || a.type.localeCompare(b.type));
}

class MailOptionsService {
  async options(orgId, user, { type: typeKey, clientId, locationId, date }, mailService) {
    const type = types.get(typeKey);
    if (!type) throw new BadRequestError('Unknown mail type');

    const teamIds = visibleTeamIds(user);
    if (Array.isArray(teamIds) && teamIds.length === 0) return buildOptions({ type, trackers: [], profiles: new Map(), tz: 'UTC' });

    const CT = schema.candidateTracker;
    const conditions = [eq(CT.organisationId, orgId), inArray(CT.status, type.statuses)];
    if (Array.isArray(teamIds)) conditions.push(inArray(CT.teamId, teamIds));
    const rows = await db.select().from(CT).where(and(...conditions));
    const trackers = await trackersService._enrichTrackers(rows);

    const [org] = await db.select({ timezone: schema.organisation.timezone }).from(schema.organisation).where(eq(schema.organisation.id, orgId));
    const profiles = clientId ? await mailService._profiles(orgId, [clientId]) : new Map();
    return buildOptions({ type, trackers, profiles, clientId, locationId, date, tz: org?.timezone || 'UTC' });
  }
  /** What is still to send over the next two weeks, across every day-based mail type. */
  async pending(orgId, user, mailService) {
    const teamIds = visibleTeamIds(user);
    if (Array.isArray(teamIds) && teamIds.length === 0) return [];
    const CT = schema.candidateTracker;
    const conditions = [eq(CT.organisationId, orgId), inArray(CT.status, ['active', 'on_hold'])];
    if (Array.isArray(teamIds)) conditions.push(inArray(CT.teamId, teamIds));
    const trackers = await trackersService._enrichTrackers(await db.select().from(CT).where(and(...conditions)));
    const [org] = await db.select({ timezone: schema.organisation.timezone }).from(schema.organisation).where(eq(schema.organisation.id, orgId));
    const tz = org?.timezone || 'UTC';
    const clientIds = [...new Set(trackers.map((t) => t.clientId).filter(Boolean))];
    if (!clientIds.length) return [];
    const profiles = await mailService._profiles(orgId, clientIds);
    const L = schema.clientMailLog;
    const logs = await db.select({ clientId: L.clientId, locationId: L.locationId, mailType: L.mailType, trackerIds: L.trackerIds, sentAt: L.sentAt, first: schema.user.firstName })
      .from(L).leftJoin(schema.user, eq(schema.user.id, L.sentBy))
      .where(and(eq(L.organisationId, orgId), inArray(L.clientId, clientIds), gte(L.sentAt, new Date(Date.now() - 14 * 24 * 3600 * 1000))));
    const today = localDate(new Date(), tz);
    const until = addDays(today, 14);
    return buildPending({ trackers, profiles, logs, tz, today, until });
  }
}

module.exports = Object.assign(new MailOptionsService(), { buildOptions, buildPending, OTHER, ALL });
