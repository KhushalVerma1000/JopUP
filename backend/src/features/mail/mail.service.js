const { db, schema } = require('../../utils/db');
const { and, eq, inArray } = require('drizzle-orm');
const { NotFoundError, BadRequestError } = require('../../utils/errors');
const { visibleTeamIds } = require('../../utils/teamScope');
const trackersService = require('../trackers/trackers.service');
const { assertSingleClient } = require('./clientScope');
const { renderLineupMail, renderInterviewReminder, formatDay, formatTime } = require('../../services/email/templates/lineup');

/**
 * Builds copyable mail for day-to-day HR tasks. Stateless on purpose: nothing
 * is stored until sending exists (email_message needs a sender identity).
 */
class MailService {
  async compose(orgId, user, { type, trackerIds, clientId }) {
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
