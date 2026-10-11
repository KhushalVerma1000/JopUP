const { db, schema } = require('../../utils/db');
const { and, eq, inArray } = require('drizzle-orm');
const { visibleTeamIds } = require('../../utils/teamScope');
const trackersService = require('../trackers/trackers.service');
const { matchLocation } = require('./locationMatch');
const { localDate } = require('../../utils/zonedTime');
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
}

module.exports = Object.assign(new MailOptionsService(), { buildOptions, OTHER, ALL });
