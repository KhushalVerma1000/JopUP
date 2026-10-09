const { db, schema } = require('../../utils/db');
const { and, eq, inArray } = require('drizzle-orm');
const { NotFoundError, BadRequestError } = require('../../utils/errors');
const { visibleTeamIds } = require('../../utils/teamScope');
const trackersService = require('../trackers/trackers.service');
const { assertSingleClient } = require('./clientScope');
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
   * Tracker mail: the chosen columns as one Excel-style table, one mail per
   * client. Columns come from this send's toggles, else the template, else the
   * defaults. A candidate from another client can never land in a client's mail:
   * trackers are grouped by client here, and assertSingleClient already refused
   * a mixed list when the caller named the client.
   */
  async _tracker(orgId, user, trackers, ctx) {
    const live = trackers.filter((t) => ['active', 'on_hold'].includes(t.status));
    if (live.length === 0) throw new BadRequestError('None of those candidates are in the active pipeline');

    let spec = ctx.columns;
    let template = null;
    if (!spec && ctx.templateId) {
      template = await templatesService.get(orgId, user, ctx.templateId);
      spec = template.columns;
    }
    const columns = (spec && spec.length ? spec : DEFAULT_COLUMNS).map((c) => ({ key: c.key, label: labelFor(c.key, c.label) }));

    const cands = await db.select({ id: schema.candidate.id, email: schema.candidate.email, customFields: schema.candidate.customFields })
      .from(schema.candidate).where(inArray(schema.candidate.id, [...new Set(live.map((t) => t.candidateId))]));
    const candById = new Map(cands.map((c) => [c.id, c]));

    const byClient = new Map();
    for (const t of live) {
      const key = t.clientName || '';
      if (!byClient.has(key)) byClient.set(key, []);
      byClient.get(key).push(t);
    }

    const messages = [...byClient.entries()].map(([clientName, list]) => {
      const sorted = [...list].sort((a, b) => new Date(a.lineupDate || a.interviewDate || 0) - new Date(b.lineupDate || b.interviewDate || 0));
      const rows = sorted.map((t) => columns.map((c) => resolveValue(c.key, t, { tz: ctx.tz, candidate: candById.get(t.candidateId) })));
      const title = `${template?.name || 'Tracker'}${clientName ? ` — ${clientName}` : ''}, ${formatDay(new Date(), ctx.tz)}`;
      const mail = renderTrackerMail({ clientName: clientName || null, title, columns, rows, senderName: ctx.senderName, orgName: ctx.orgName });
      return { clientName: clientName || null, candidateCount: list.length, columns: columns.map((c) => c.key), ...mail };
    });
    return { type: 'tracker', templateId: template?.id || null, messages };
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
