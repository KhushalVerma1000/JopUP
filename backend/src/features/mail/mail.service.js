const { db, schema } = require('../../utils/db');
const { and, eq, inArray } = require('drizzle-orm');
const { NotFoundError, BadRequestError } = require('../../utils/errors');
const { visibleTeamIds } = require('../../utils/teamScope');
const trackersService = require('../trackers/trackers.service');
const { assertSingleClient } = require('./clientScope');
const { matchLocation } = require('./locationMatch');
const { auditWrite } = require('../../utils/audit');
const { renderTrackerMail } = require('../../services/email/templates/trackerTable');
const templatesService = require('./templates.service');
const { DEFAULT_COLUMNS, labelFor, resolveValue } = require('./columns');
const { renderLineupMail, renderInterviewReminder, formatDay, formatTime } = require('../../services/email/templates/lineup');

/**
 * Builds copyable mail for day-to-day HR tasks. Stateless on purpose: nothing
 * is stored until sending exists (email_message needs a sender identity).
 */
class MailService {
  async compose(orgId, user, { type, trackerIds, clientId, templateId, columns }) {
    const ids = [...new Set(trackerIds)];
    const teamIds = visibleTeamIds(user);
    if (Array.isArray(teamIds) && teamIds.length === 0) throw new NotFoundError('Candidates not found');

    const CT = schema.candidateTracker;
    const conditions = [eq(CT.organisationId, orgId), inArray(CT.id, ids)];
    if (Array.isArray(teamIds)) conditions.push(inArray(CT.teamId, teamIds));
    const rows = await db.select().from(CT).where(and(...conditions));
    // Out-of-team and nonexistent look the same: don't confirm other ids exist.
    if (rows.length !== ids.length) throw new NotFoundError('Some of those candidates were not found');

    const [org] = await db.select({ name: schema.organisation.name, timezone: schema.organisation.timezone })
      .from(schema.organisation).where(eq(schema.organisation.id, orgId));
    const [me] = await db.select({ firstName: schema.user.firstName, lastName: schema.user.lastName })
      .from(schema.user).where(eq(schema.user.id, user.userId));
    const tz = org?.timezone || 'UTC';
    const senderName = [me?.firstName, me?.lastName].filter(Boolean).join(' ');
    const trackers = assertSingleClient(await trackersService._enrichTrackers(rows), clientId);

    if (type === 'tracker') return this._tracker(orgId, user, trackers, { tz, senderName, orgName: org?.name, templateId, columns });
    if (type === 'interview_reminder') return this._interviewReminders(trackers, { tz, senderName, orgName: org?.name });
    return this._lineup(trackers, { tz, senderName, orgName: org?.name });
  }

  async _lineup(trackers, ctx) {
    const live = trackers.filter((t) => ['active', 'on_hold'].includes(t.status));
    if (live.length === 0) throw new BadRequestError('None of those candidates are in the active pipeline');

    // One mail per client — a mail never mixes two clients' candidates.
    const byClient = new Map();
    for (const t of live) {
      const key = t.clientName || '';
      if (!byClient.has(key)) byClient.set(key, []);
      byClient.get(key).push(t);
    }

    const messages = [...byClient.entries()].map(([clientName, list]) => {
      const days = [...new Set(list.map((t) => (t.lineupDate ? formatDay(t.lineupDate, ctx.tz) : '')).filter(Boolean))];
      const dateLabel = days.length === 0 ? 'upcoming' : days.length === 1 ? days[0] : `${days[0]} – ${days[days.length - 1]}`;
      const sorted = [...list].sort((a, b) => new Date(a.lineupDate || 0) - new Date(b.lineupDate || 0));
      const mail = renderLineupMail({
        clientName: clientName || null,
        dateLabel,
        senderName: ctx.senderName,
        orgName: ctx.orgName,
        rows: sorted.map((t) => ({
          name: t.candidateName, phone: t.candidatePhone, location: t.candidateLocation,
          position: t.openPositionDesignation, time: formatTime(t.lineupDate, ctx.tz),
          // When the list spans days, say which day each person is on.
          ...(days.length > 1 && t.lineupDate ? { time: [formatDay(t.lineupDate, ctx.tz), formatTime(t.lineupDate, ctx.tz)].filter(Boolean).join(' ') } : {}),
        })),
      });
      return {
        clientName: clientName || null,
        candidateCount: list.length,
        missingLineupDate: list.filter((t) => !t.lineupDate).length,
        ...mail,
      };
    });
    return { type: 'lineup', messages };
  }

  /**
   * Tracker mail: the chosen columns as one Excel-style table. One mail per
   * (client, location): each location has its own contacts and template, so
   * Aligarh's list never goes to Noida's HR. A candidate from another client
   * can never land in a client's mail: trackers are grouped by client here, and
   * assertSingleClient already refused a mixed list when the caller named the client.
   *
   * Columns: this send's toggles win, then an explicitly chosen template, then
   * the location's own template, then the standard columns.
   */
  async _tracker(orgId, user, trackers, ctx) {
    const live = trackers.filter((t) => ['active', 'on_hold'].includes(t.status));
    if (live.length === 0) throw new BadRequestError('None of those candidates are in the active pipeline');

    const chosen = !ctx.columns && ctx.templateId ? await templatesService.get(orgId, user, ctx.templateId) : null;
    // Auto: location's template, else the template the manager marked default, else the standard columns.
    const fallback = ctx.columns || chosen ? null : (await templatesService.list(orgId, user)).find((t) => t.isDefault) || null;

    const cands = await db.select({ id: schema.candidate.id, email: schema.candidate.email, customFields: schema.candidate.customFields })
      .from(schema.candidate).where(inArray(schema.candidate.id, [...new Set(live.map((t) => t.candidateId))]));
    const candById = new Map(cands.map((c) => [c.id, c]));

    const profiles = await this._profiles(orgId, [...new Set(live.map((t) => t.clientId).filter(Boolean))]);

    const groups = new Map();
    for (const t of live) {
      const profile = t.clientId ? profiles.get(t.clientId) : null;
      const locationId = profile ? matchLocation(t.candidateLocation, profile.locations) : null;
      const key = `${t.clientId || ''}|${locationId || ''}`;
      if (!groups.has(key)) groups.set(key, { clientId: t.clientId || null, clientName: t.clientName || null, locationId, profile, list: [] });
      groups.get(key).list.push(t);
    }

    const templateCache = new Map();
    const templateFor = async (id) => {
      if (!id) return null;
      if (!templateCache.has(id)) {
        const [row] = await db.select().from(schema.trackerTemplate).where(and(eq(schema.trackerTemplate.id, id), eq(schema.trackerTemplate.organisationId, orgId)));
        templateCache.set(id, row || null);
      }
      return templateCache.get(id);
    };

    const messages = [];
    for (const g of groups.values()) {
      const location = g.locationId ? g.profile.locations.find((l) => l.id === g.locationId) : null;
      const template = chosen || (ctx.columns ? null : (await templateFor(location?.trackerTemplateId)) || fallback);
      const spec = ctx.columns || template?.columns;
      const columns = (spec && spec.length ? spec : DEFAULT_COLUMNS).map((c) => ({ key: c.key, label: labelFor(c.key, c.label) }));

      const sorted = [...g.list].sort((a, b) => new Date(a.lineupDate || a.interviewDate || 0) - new Date(b.lineupDate || b.interviewDate || 0));
      const rows = sorted.map((t) => columns.map((c) => resolveValue(c.key, t, { tz: ctx.tz, candidate: candById.get(t.candidateId) })));
      const title = `${template?.name || 'Tracker'}${g.clientName ? ` — ${g.clientName}` : ''}${location ? ` · ${location.name}` : ''}, ${formatDay(new Date(), ctx.tz)}`;
      const recipients = this._recipients(g.profile, location);
      const mail = renderTrackerMail({ clientName: g.clientName, title, columns, rows, senderName: ctx.senderName, orgName: ctx.orgName });
      messages.push({
        clientId: g.clientId,
        clientName: g.clientName,
        locationId: location?.id || null,
        locationName: location?.name || null,
        // The client has locations set up, but this candidate fits none: HR should fix the aliases.
        locationUnmatched: !!g.profile && g.profile.locations.length > 0 && !location,
        to: recipients.to,
        cc: recipients.cc,
        recipientsFrom: recipients.from,
        templateId: template?.id || null,
        templateName: template?.name || null,
        trackerIds: sorted.map((t) => t.id),
        candidateCount: g.list.length,
        columns: columns.map((c) => c.key),
        ...mail,
      });
    }
    messages.sort((a, b) => (a.clientName || '').localeCompare(b.clientName || '') || (a.locationName || '').localeCompare(b.locationName || ''));
    return { type: 'tracker', templateId: chosen?.id || null, messages };
  }

  /** Locations and active contacts for each client in the mail, in two queries. */
  async _profiles(orgId, clientIds) {
    const out = new Map(clientIds.map((id) => [id, { locations: [], contacts: [] }]));
    if (!clientIds.length) return out;
    const locs = await db.select().from(schema.clientLocation)
      .where(and(eq(schema.clientLocation.organisationId, orgId), inArray(schema.clientLocation.clientId, clientIds)));
    const spocs = await db.select().from(schema.clientSpoc)
      .where(and(eq(schema.clientSpoc.organisationId, orgId), inArray(schema.clientSpoc.clientId, clientIds), eq(schema.clientSpoc.status, 'active'), eq(schema.clientSpoc.receivesTrackersByDefault, true)));
    for (const l of locs) out.get(l.clientId).locations.push(l);
    for (const c of spocs) out.get(c.clientId).contacts.push(c);
    return out;
  }

  /** The location's contacts; if it has none (or no location matched), the client-wide ones. */
  _recipients(profile, location) {
    if (!profile) return { to: [], cc: [], from: null };
    const pick = (list) => ({
      to: list.filter((c) => c.mailRole === 'to').map((c) => ({ name: c.name, email: c.email, designation: c.designation || null })),
      cc: list.filter((c) => c.mailRole === 'cc').map((c) => ({ name: c.name, email: c.email, designation: c.designation || null })),
    });
    if (location) {
      const own = pick(profile.contacts.filter((c) => c.locationId === location.id));
      if (own.to.length || own.cc.length) return { ...own, from: 'location' };
    }
    const wide = pick(profile.contacts.filter((c) => !c.locationId));
    return { ...wide, from: wide.to.length || wide.cc.length ? 'client' : null };
  }

  /**
   * "Mark as sent": the mail itself is pasted into HR's own mail app, so this
   * only records that it went, to whom, and which candidates it covered.
   */
  async markSent(orgId, user, { clientId, locationId, templateId, subject, to, cc, trackerIds }) {
    const ids = [...new Set(trackerIds)];
    const teamIds = visibleTeamIds(user);
    if (Array.isArray(teamIds) && teamIds.length === 0) throw new NotFoundError('Candidates not found');
    const CT = schema.candidateTracker;
    const conditions = [eq(CT.organisationId, orgId), inArray(CT.id, ids)];
    if (Array.isArray(teamIds)) conditions.push(inArray(CT.teamId, teamIds));
    const rows = await db.select().from(CT).where(and(...conditions));
    if (rows.length !== ids.length) throw new NotFoundError('Some of those candidates were not found');
    // Same rule as composing: nothing from another client is ever logged against this one.
    assertSingleClient(await trackersService._enrichTrackers(rows), clientId);

    const [c] = await db.select({ id: schema.client.id }).from(schema.client).where(and(eq(schema.client.id, clientId), eq(schema.client.organisationId, orgId)));
    if (!c) throw new NotFoundError('Client not found');
    if (locationId) {
      const [l] = await db.select({ id: schema.clientLocation.id }).from(schema.clientLocation).where(and(eq(schema.clientLocation.id, locationId), eq(schema.clientLocation.clientId, clientId)));
      if (!l) throw new BadRequestError('Location not found for this client');
    }
    const [row] = await db.insert(schema.clientMailLog).values({
      organisationId: orgId, clientId, locationId: locationId || null, templateId: templateId || null, sentBy: user.userId,
      subject, toEmails: to, ccEmails: cc, trackerIds: ids, candidateCount: ids.length,
    }).returning();
    await auditWrite(orgId, user.userId, 'create', 'client_mail_log', row.id, null, row, 'mail');
    return row;
  }

  async _interviewReminders(trackers, ctx) {
    const live = trackers.filter((t) => ['active', 'on_hold'].includes(t.status));
    if (live.length === 0) throw new BadRequestError('None of those candidates are in the active pipeline');

    const cands = await db.select({ id: schema.candidate.id, email: schema.candidate.email })
      .from(schema.candidate).where(inArray(schema.candidate.id, live.map((t) => t.candidateId)));
    const emailById = new Map(cands.map((c) => [c.id, c.email]));

    const messages = live.map((t) => ({
      trackerId: t.id,
      candidateName: t.candidateName,
      candidatePhone: t.candidatePhone,
      candidatePhoneE164: t.candidatePhoneE164,
      candidateEmail: emailById.get(t.candidateId) || null,
      missingInterviewDate: !t.interviewDate,
      ...renderInterviewReminder({
        candidateName: t.candidateName,
        position: t.openPositionDesignation,
        clientName: t.clientName,
        dayLabel: t.interviewDate ? formatDay(t.interviewDate, ctx.tz) : '',
        time: formatTime(t.interviewDate, ctx.tz),
        location: t.openPositionLocation,
        senderName: ctx.senderName,
        orgName: ctx.orgName,
      }),
    }));
    return { type: 'interview_reminder', messages };
  }
}

module.exports = new MailService();
