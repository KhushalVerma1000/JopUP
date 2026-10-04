const { db, schema } = require('../../utils/db');
const { eq, and, or, isNull, inArray, gte, lt, ne, sql, desc } = require('drizzle-orm');
const { NotFoundError, BadRequestError, ConflictError } = require('../../utils/errors');
const { canSeeTeam } = require('../../utils/teamScope');
const { auditWrite } = require('../../utils/audit');
const { sendEmail } = require('../../services/email');
const { localDate, localDayBounds, isDue, assertTimeZone, addDays } = require('../../utils/zonedTime');
const { outgoingStageLabel } = require('../../utils/stageLabels');
const { renderDailyTrackerEmail, renderDailyTrackerText } = require('../../services/email/templates/dailyTracker');

const isUniqueViolation = (err) => (err?.code || err?.cause?.code) === '23505';
const STALE_RUN_MS = 10 * 60 * 1000;
const MAX_SCHEDULED_ATTEMPTS = 3;

// The columns of the default "Daily Tracker" template (module 16 tracker_template.columns).
const DEFAULT_COLUMNS = [
  { key: 'name', label: 'Name' }, { key: 'number', label: 'Number' }, { key: 'position', label: 'Position' },
  { key: 'location', label: 'Location' }, { key: 'stage', label: 'Stage' }, { key: 'status', label: 'Status' },
  { key: 'interview', label: 'Interview' },
];

const dateLabel = (ymd, tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  .format(localDayBounds(ymd, tz).start);
const fmtWhen = (d, tz) => (d ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }).format(d) : '');

class DailyTrackersService {
  // ── helpers ─────────────────────────────────────────────────────────────
  async _orgTimezone(orgId) {
    const [org] = await db.select({ tz: schema.organisation.timezone, name: schema.organisation.name }).from(schema.organisation).where(eq(schema.organisation.id, orgId));
    return { tz: org?.tz || 'UTC', name: org?.name || '' };
  }

  _tz(schedule, orgTz) { return schedule?.timezone || orgTz || 'UTC'; }

  async getScheduleOrThrow(orgId, id, user) {
    const [s] = await db.select().from(schema.dailyTrackerSchedule)
      .where(and(eq(schema.dailyTrackerSchedule.id, id), eq(schema.dailyTrackerSchedule.organisationId, orgId)));
    if (!s || (user && !canSeeTeam(user, s.teamId))) throw new NotFoundError('Schedule not found');
    return s;
  }

  // ── snapshot ────────────────────────────────────────────────────────────
  /**
   * The tracker for one team + client on one LOCAL day.
   * clientId null = the team's internal hires (positions with no client, plus
   * candidates not tagged to any position).
   *
   * Included: everyone still in play (active / on hold), plus anyone who joined
   * or was rejected during the day. Each row says whether it is new today or
   * was updated today, so a client can see what changed without diffing.
   */
  async buildSnapshot(orgId, { teamId, clientId = null, date, tz }) {
    const { start, end } = localDayBounds(date, tz);
    const CT = schema.candidateTracker;

    const positions = await db.select().from(schema.openPosition).where(and(
      eq(schema.openPosition.organisationId, orgId), eq(schema.openPosition.teamId, teamId),
      ne(schema.openPosition.status, 'cancelled'),
      clientId ? eq(schema.openPosition.clientId, clientId) : isNull(schema.openPosition.clientId),
    ));
    const posById = new Map(positions.map((p) => [p.id, p]));
    const posIds = positions.map((p) => p.id);

    const scope = clientId
      ? (posIds.length ? inArray(CT.openPositionId, posIds) : null)
      : (posIds.length ? or(isNull(CT.openPositionId), inArray(CT.openPositionId, posIds)) : isNull(CT.openPositionId));

    const empty = () => ({ date, tz, teamId, clientId, rows: [], summary: { total: 0, active: 0, onHold: 0, newToday: 0, updatedToday: 0, joinedToday: 0, rejectedToday: 0, byStage: [] } });
    if (!scope) return empty();

    const trackers = await db.select().from(CT).where(and(
      eq(CT.organisationId, orgId), eq(CT.teamId, teamId), scope,
      or(inArray(CT.status, ['active', 'on_hold']), gte(CT.updatedAt, start)),
    ));
    if (trackers.length === 0) return empty();
    const ids = trackers.map((t) => t.id);

    const L = schema.candidateTrackerStageLog;
    const logs = await db.select().from(L).where(and(
      inArray(L.trackerId, ids),
      or(isNull(L.exitedAt), gte(L.exitedAt, start), and(gte(L.enteredAt, start), lt(L.enteredAt, end))),
    ));
    const stageIds = [...new Set(logs.map((l) => l.stageId))];
    const stages = stageIds.length ? await db.select().from(schema.workflowStage).where(inArray(schema.workflowStage.id, stageIds)) : [];
    const stageById = new Map(stages.map((s) => [s.id, s]));
    const cands = await db.select().from(schema.candidate).where(inArray(schema.candidate.id, [...new Set(trackers.map((t) => t.candidateId))]));
    const candById = new Map(cands.map((c) => [c.id, c]));

    const inDay = (d) => d && d >= start && d < end;
    const rows = [];
    for (const t of trackers) {
      const mine = logs.filter((l) => l.trackerId === t.id);
      const closedToday = ['placed', 'rejected'].includes(t.status) && inDay(t.updatedAt);
      if (!['active', 'on_hold'].includes(t.status) && !closedToday) continue;

      const cur = mine.find((l) => !l.exitedAt) || [...mine].sort((a, b) => b.enteredAt - a.enteredAt)[0];
      const stage = cur && stageById.get(cur.stageId);
      const c = candById.get(t.candidateId);
      const pos = t.openPositionId ? posById.get(t.openPositionId) : null;
      const change = inDay(t.createdAt) ? 'new' : (mine.some((l) => inDay(l.enteredAt)) || closedToday ? 'updated' : null);

      rows.push({
        candidateId: t.candidateId,
        trackerId: t.id,
        name: [c?.firstName, c?.lastName].filter(Boolean).join(' '),
        number: c?.phone || '',
        position: pos?.designation || 'Not tagged to a position',
        location: c?.location || pos?.location || '',
        // Outgoing wording ("Reached" for Turn up) — see utils/stageLabels.js
        stage: stage ? outgoingStageLabel(stage.stageKey, stage.name) : '',
        stageKey: stage?.stageKey || '',
        status: t.status === 'on_hold' ? 'On hold' : t.status === 'placed' ? 'Joined' : t.status === 'rejected' ? 'Rejected' : (cur?.notes || ''),
        interview: fmtWhen(t.interviewDate, tz),
        change,
        _group: t.status === 'active' ? 0 : t.status === 'on_hold' ? 1 : 2,
        _order: stage?.orderIndex ?? 0,
        _state: t.status,
      });
    }
    rows.sort((a, b) => a._group - b._group || b._order - a._order || a.name.localeCompare(b.name));

    const active = rows.filter((r) => r._state === 'active');
    const byStageMap = new Map();
    for (const r of active) {
      const k = r.stageKey || r.stage;
      byStageMap.set(k, { label: r.stage, order: r._order, count: (byStageMap.get(k)?.count || 0) + 1 });
    }
    const summary = {
      total: rows.length,
      active: active.length,
      onHold: rows.filter((r) => r._state === 'on_hold').length,
      newToday: rows.filter((r) => r.change === 'new').length,
      updatedToday: rows.filter((r) => r.change === 'updated').length,
      joinedToday: rows.filter((r) => r._state === 'placed').length,
      rejectedToday: rows.filter((r) => r._state === 'rejected').length,
      byStage: [...byStageMap.values()].sort((a, b) => a.order - b.order).map(({ label, count }) => ({ label, count })),
    };
    // Frozen rows carry only what the client sees (no internal sort keys / state).
    const clean = rows.map(({ _group, _order, _state, ...r }) => r);
    return { date, tz, teamId, clientId, rows: clean, summary };
  }

  _titles(snapshot, { clientName, teamName }) {
    const who = snapshot.clientId ? clientName : `${teamName} — internal hires`;
    return { title: `Daily tracker — ${who}`, subject: `Daily tracker — ${who} — ${snapshot.date}` };
  }

  /** What HR pastes into the group chat. */
  copyText(snapshot, names) {
    const { title } = this._titles(snapshot, names);
    return renderDailyTrackerText({ title, dateLabel: dateLabel(snapshot.date, snapshot.tz), summary: snapshot.summary, rows: snapshot.rows });
  }

  // ── overview (the Daily tracker tab) ────────────────────────────────────
  async overview(orgId, user, { teamId, date }) {
    if (!canSeeTeam(user, teamId)) throw new NotFoundError('Team not found');
    const { tz: orgTz } = await this._orgTimezone(orgId);
    const [team] = await db.select().from(schema.team).where(and(eq(schema.team.id, teamId), eq(schema.team.organisationId, orgId)));
    if (!team) throw new NotFoundError('Team not found');

    const schedules = await db.select().from(schema.dailyTrackerSchedule).where(and(eq(schema.dailyTrackerSchedule.organisationId, orgId), eq(schema.dailyTrackerSchedule.teamId, teamId)));
    const schedByClient = new Map(schedules.map((s) => [s.clientId || 'internal', s]));
    const positions = await db.select({ clientId: schema.openPosition.clientId }).from(schema.openPosition).where(and(
      eq(schema.openPosition.organisationId, orgId), eq(schema.openPosition.teamId, teamId), ne(schema.openPosition.status, 'cancelled')));
    const clientIds = [...new Set(positions.map((p) => p.clientId).filter(Boolean))];
    const clients = clientIds.length ? await db.select({ id: schema.client.id, name: schema.client.companyName }).from(schema.client).where(inArray(schema.client.id, clientIds)) : [];

    const groups = [...clients.map((c) => ({ clientId: c.id, clientName: c.name })), { clientId: null, clientName: 'Internal hires' }];
    const out = [];
    for (const g of groups) {
      const sched = schedByClient.get(g.clientId || 'internal') || null;
      const tz = this._tz(sched, orgTz);
      const day = date || localDate(new Date(), tz);
      const snapshot = await this.buildSnapshot(orgId, { teamId, clientId: g.clientId, date: day, tz });
      if (snapshot.rows.length === 0 && !sched && !g.clientId) continue;       // hide an empty internal group
      const [lastRun] = sched ? await db.select().from(schema.dailyTrackerRun).where(eq(schema.dailyTrackerRun.scheduleId, sched.id)).orderBy(desc(schema.dailyTrackerRun.createdAt)).limit(1) : [];
      out.push({
        clientId: g.clientId, clientName: g.clientName, date: day, tz,
        summary: snapshot.summary, rows: snapshot.rows,
        text: this.copyText(snapshot, { clientName: g.clientName, teamName: team.name }),
        schedule: sched, lastRun: lastRun ? { status: lastRun.status, trackerDate: lastRun.trackerDate, trigger: lastRun.trigger, error: lastRun.error, finishedAt: lastRun.finishedAt } : null,
      });
    }
    return { teamId, teamName: team.name, date: date || localDate(new Date(), orgTz), groups: out };
  }

  // ── recipients ──────────────────────────────────────────────────────────
  async resolveRecipients(orgId, schedule) {
    const to = new Map();
    const cc = new Map();
    const add = (map, email, name, source, ids = {}) => {
      const key = String(email || '').trim().toLowerCase();
      if (key && !map.has(key)) map.set(key, { email: key, name: name || null, source, ...ids });
    };
    for (const e of schedule.toEmails || []) add(to, e, null, 'manual');
    for (const e of schedule.ccEmails || []) add(cc, e, null, 'manual');

    if (schedule.includeClientContacts && schedule.clientId) {
      const spocs = await db.select().from(schema.clientSpoc).where(and(
        eq(schema.clientSpoc.organisationId, orgId), eq(schema.clientSpoc.clientId, schedule.clientId),
        eq(schema.clientSpoc.status, 'active'), eq(schema.clientSpoc.receivesTrackersByDefault, true)));
      for (const s of spocs) add(to, s.email, s.name, 'client_spoc', { clientSpocId: s.id });

      const internal = await db.select({ userId: schema.clientInternalContact.userId, email: schema.user.email, first: schema.user.firstName, last: schema.user.lastName })
        .from(schema.clientInternalContact).innerJoin(schema.user, eq(schema.user.id, schema.clientInternalContact.userId))
        .where(and(eq(schema.clientInternalContact.organisationId, orgId), eq(schema.clientInternalContact.clientId, schedule.clientId), eq(schema.clientInternalContact.isDefaultCc, true)));
      for (const u of internal) add(cc, u.email, [u.first, u.last].filter(Boolean).join(' '), 'internal_user', { internalUserId: u.userId });
    }
    for (const k of to.keys()) cc.delete(k);        // someone on To is never also on Cc
    return { to: [...to.values()], cc: [...cc.values()] };
  }

  // ── schedules CRUD ──────────────────────────────────────────────────────
  async listSchedules(orgId, user, { teamId } = {}) {
    const rows = await db.select().from(schema.dailyTrackerSchedule).where(and(
      eq(schema.dailyTrackerSchedule.organisationId, orgId), teamId ? eq(schema.dailyTrackerSchedule.teamId, teamId) : undefined));
    const visible = rows.filter((s) => canSeeTeam(user, s.teamId));
    const clientIds = [...new Set(visible.map((s) => s.clientId).filter(Boolean))];
    const clients = clientIds.length ? await db.select({ id: schema.client.id, name: schema.client.companyName }).from(schema.client).where(inArray(schema.client.id, clientIds)) : [];
    const nameOf = new Map(clients.map((c) => [c.id, c.name]));
    return visible.map((s) => ({ ...s, clientName: s.clientId ? nameOf.get(s.clientId) || null : null }));
  }

  async _validate(orgId, data, existing) {
    if (data.timezone) { try { assertTimeZone(data.timezone); } catch (e) { throw new BadRequestError(e.message); } }
    const teamId = data.teamId || existing?.teamId;
    const clientId = data.clientId === undefined ? existing?.clientId : data.clientId;
    if (data.teamId) {
      const [t] = await db.select({ id: schema.team.id }).from(schema.team).where(and(eq(schema.team.id, data.teamId), eq(schema.team.organisationId, orgId)));
      if (!t) throw new NotFoundError('Team not found');
    }
    if (clientId) {
      const [c] = await db.select({ id: schema.client.id }).from(schema.client).where(and(eq(schema.client.id, clientId), eq(schema.client.organisationId, orgId)));
      if (!c) throw new NotFoundError('Client not found');
    }
    return { teamId, clientId };
  }

  async createSchedule(orgId, data, userId) {
    await this._validate(orgId, data);
    try {
      const [s] = await db.insert(schema.dailyTrackerSchedule).values({ ...data, organisationId: orgId, createdBy: userId, clientId: data.clientId || null }).returning();
      await auditWrite(orgId, userId, 'create', 'daily_tracker_schedule', s.id, null, s, 'pipeline');
      return s;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError(data.clientId ? 'This client already has a daily tracker schedule' : 'This team already has an internal daily tracker schedule');
      throw err;
    }
  }

  async updateSchedule(orgId, id, data, userId, user) {
    const before = await this.getScheduleOrThrow(orgId, id, user);
    if (data.teamId && data.teamId !== before.teamId) throw new BadRequestError("A schedule can't move to another team — create a new one");
    await this._validate(orgId, data, before);
    const [s] = await db.update(schema.dailyTrackerSchedule).set({ ...data, updatedAt: new Date() })
      .where(and(eq(schema.dailyTrackerSchedule.id, id), eq(schema.dailyTrackerSchedule.organisationId, orgId))).returning();
    await auditWrite(orgId, userId, 'update', 'daily_tracker_schedule', id, before, s, 'pipeline');
    return s;
  }

  async deleteSchedule(orgId, id, userId, user) {
    const before = await this.getScheduleOrThrow(orgId, id, user);
    await db.delete(schema.dailyTrackerSchedule).where(and(eq(schema.dailyTrackerSchedule.id, id), eq(schema.dailyTrackerSchedule.organisationId, orgId)));
    await auditWrite(orgId, userId, 'delete', 'daily_tracker_schedule', id, before, null, 'pipeline');
  }

  async listRuns(orgId, id, user) {
    await this.getScheduleOrThrow(orgId, id, user);
    return db.select().from(schema.dailyTrackerRun).where(eq(schema.dailyTrackerRun.scheduleId, id)).orderBy(desc(schema.dailyTrackerRun.createdAt)).limit(30);
  }

  // ── sender / template provisioning (race-safe, no extra connection held) ─
  async _ensureSender(orgId, actor) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'dt-sender:' + orgId}))`);
      const [existing] = await tx.select().from(schema.emailSenderIdentity)
        .where(and(eq(schema.emailSenderIdentity.organisationId, orgId), eq(schema.emailSenderIdentity.isDefault, true)));
      if (existing) return existing;
      const raw = process.env.EMAIL_FROM || 'JopUP <onboarding@resend.dev>';
      const m = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
      const [created] = await tx.insert(schema.emailSenderIdentity).values({
        organisationId: orgId, fromName: m ? (m[1] || 'JopUP') : 'JopUP', fromEmail: m ? m[2] : raw, isVerified: true, isDefault: true,
      }).returning();
      return created;
    });
  }

  async _ensureTemplate(orgId, teamId, actor) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'dt-template:' + teamId}))`);
      const T = schema.trackerTemplate;
      const [existing] = await tx.select().from(T).where(and(eq(T.organisationId, orgId), eq(T.teamId, teamId), eq(T.trackerType, 'status_tracker'), eq(T.isDefault, true)));
      if (existing) return existing;
      const [created] = await tx.insert(T).values({ organisationId: orgId, teamId, createdBy: actor, name: 'Daily Tracker', trackerType: 'status_tracker', columns: DEFAULT_COLUMNS, isDefault: true }).returning();
      return created;
    });
  }

  // ── running a schedule ──────────────────────────────────────────────────
  /**
   * Generate today's tracker for a schedule and email it.
   *
   * The run row is inserted FIRST and is the claim: for scheduled runs a
   * partial unique index (one non-failed scheduled run per schedule per day)
   * makes a second attempt — another server, an overlapping tick — fail the
   * insert, and we return without doing anything. Email is therefore sent at
   * most once per schedule per day, and a failed run frees the slot so the
   * next tick retries (up to MAX_SCHEDULED_ATTEMPTS).
   *
   * Known limit: if the process dies between the provider accepting the mail
   * and us recording it, the stale-run reaper marks the run failed and a retry
   * sends again — at-least-once, never silently never. Fixing that needs
   * provider idempotency keys.
   */
  async runSchedule(scheduleId, { trigger, userId = null, now = new Date() }) {
    const [schedule] = await db.select().from(schema.dailyTrackerSchedule).where(eq(schema.dailyTrackerSchedule.id, scheduleId));
    if (!schedule) throw new NotFoundError('Schedule not found');
    const orgId = schedule.organisationId;
    const { tz: orgTz, name: orgName } = await this._orgTimezone(orgId);
    const tz = this._tz(schedule, orgTz);
    const date = localDate(now, tz);
    const actor = userId || schedule.createdBy;
    const R = schema.dailyTrackerRun;

    let run;
    try {
      [run] = await db.insert(R).values({ organisationId: orgId, scheduleId, trackerDate: date, trigger, triggeredBy: userId }).returning();
    } catch (err) {
      if (isUniqueViolation(err)) return { alreadyRan: true, run: null };
      throw err;
    }

    const finish = async (patch) => {
      const [r] = await db.update(R).set({ ...patch, finishedAt: new Date() }).where(eq(R.id, run.id)).returning();
      return r;
    };

    try {
      const snapshot = await this.buildSnapshot(orgId, { teamId: schedule.teamId, clientId: schedule.clientId, date, tz });
      if (snapshot.rows.length === 0 && (schedule.skipIfEmpty || trigger === 'manual')) {
        return { run: await finish({ status: 'skipped', error: 'Nothing to report today' }) };
      }

      const recipients = await this.resolveRecipients(orgId, schedule);
      if (recipients.to.length === 0) throw new BadRequestError('No recipients. Add an email address or give the client a contact who receives trackers.');

      const [team] = await db.select().from(schema.team).where(eq(schema.team.id, schedule.teamId));
      let clientName = '';
      if (schedule.clientId) {
        const [c] = await db.select({ n: schema.client.companyName }).from(schema.client).where(eq(schema.client.id, schedule.clientId));
        clientName = c?.n || 'Client';
      }
      const names = { clientName, teamName: team?.name || 'Team' };
      const { title, subject } = this._titles(snapshot, names);

      const sender = await this._ensureSender(orgId, actor);
      const template = await this._ensureTemplate(orgId, schedule.teamId, actor);
      const columns = Array.isArray(template.columns) && template.columns.length ? template.columns : DEFAULT_COLUMNS;

      const label = dateLabel(date, tz);
      const html = renderDailyTrackerEmail({ title, dateLabel: label, summary: snapshot.summary, columns, rows: snapshot.rows, senderName: sender.fromName, orgName });
      const text = renderDailyTrackerText({ title, dateLabel: label, summary: snapshot.summary, rows: snapshot.rows });

      const [trk] = await db.insert(schema.tracker).values({
        organisationId: orgId, teamId: schedule.teamId, clientId: schedule.clientId, templateId: template.id, createdBy: actor,
        title: `${title} — ${date}`, trackerType: 'status_tracker', rows: snapshot.rows, rowCount: snapshot.rows.length, generatedAt: now,
      }).returning();

      const [msg] = await db.insert(schema.emailMessage).values({
        organisationId: orgId, teamId: schedule.teamId, createdBy: actor, senderId: sender.id, trackerId: trk.id,
        relatedClientId: schedule.clientId, messageType: 'tracker', subject, bodyHtml: html, status: 'queued',
      }).returning();
      const recipientRows = [...recipients.to.map((r) => ({ ...r, role: 'to' })), ...recipients.cc.map((r) => ({ ...r, role: 'cc' }))];
      await db.insert(schema.emailRecipient).values(recipientRows.map((r) => ({
        emailMessageId: msg.id, role: r.role, source: r.source, clientSpocId: r.clientSpocId || null, internalUserId: r.internalUserId || null,
        emailAddress: r.email, displayName: r.name,
      })));

      try {
        await sendEmail({
          to: recipients.to.map((r) => r.email), cc: recipients.cc.map((r) => r.email), subject, html, text,
          from: `${sender.fromName} <${sender.fromEmail}>`, replyTo: sender.replyTo || undefined,
        });
      } catch (sendErr) {
        await db.update(schema.emailMessage).set({ status: 'failed', updatedAt: new Date() }).where(eq(schema.emailMessage.id, msg.id));
        await db.update(schema.emailRecipient).set({ status: 'failed', errorMessage: String(sendErr.message).slice(0, 300) }).where(eq(schema.emailRecipient.emailMessageId, msg.id));
        throw sendErr;
      }

      const sentAt = new Date();
      await db.update(schema.emailMessage).set({ status: 'sent', sentAt, updatedAt: sentAt }).where(eq(schema.emailMessage.id, msg.id));
      await db.update(schema.emailRecipient).set({ status: 'sent', sentAt }).where(eq(schema.emailRecipient.emailMessageId, msg.id));
      const done = await finish({ status: 'sent', trackerId: trk.id, emailMessageId: msg.id, rowCount: snapshot.rows.length, recipientCount: recipientRows.length });
      await auditWrite(orgId, actor, 'send', 'daily_tracker_run', run.id, null, done, 'pipeline');
      return { run: done };
    } catch (err) {
      await finish({ status: 'failed', error: String(err.message || err).slice(0, 500) });
      if (trigger === 'manual') throw err;           // a person is waiting: tell them why
      console.error(`[daily-tracker] schedule ${scheduleId} failed: ${err.message}`);
      return { run: null, failed: true };
    }
  }

  // ── scheduler tick ──────────────────────────────────────────────────────
  /**
   * Fail runs stuck in "running" so their day can be retried. Age is measured
   * with the DATABASE clock (started_at defaults to now() there), never the
   * app's: app servers' clocks drift, and a reaper that disagreed with the
   * writer about "ten minutes ago" would free the slot of a run that is still
   * sending — and a second server would then send the same tracker again.
   */
  async reapStaleRuns() {
    const R = schema.dailyTrackerRun;
    await db.update(R).set({ status: 'failed', error: 'Timed out while running', finishedAt: sql`now()` })
      .where(and(eq(R.status, 'running'), sql`${R.startedAt} < now() - make_interval(secs => ${STALE_RUN_MS / 1000})`));
  }

  /** Send every enabled schedule that is due and hasn't gone out today. Returns the schedule ids it ran. */
  async tick(now = new Date()) {
    await this.reapStaleRuns();
    const schedules = await db.select().from(schema.dailyTrackerSchedule).where(eq(schema.dailyTrackerSchedule.enabled, true));
    if (schedules.length === 0) return [];
    const orgs = await db.select({ id: schema.organisation.id, tz: schema.organisation.timezone }).from(schema.organisation).where(inArray(schema.organisation.id, [...new Set(schedules.map((s) => s.organisationId))]));
    const orgTz = new Map(orgs.map((o) => [o.id, o.tz || 'UTC']));

    const ran = [];
    for (const s of schedules) {
      const tz = this._tz(s, orgTz.get(s.organisationId));
      if (!isDue(now, s, tz)) continue;
      const R = schema.dailyTrackerRun;
      const today = await db.select({ status: R.status }).from(R).where(and(eq(R.scheduleId, s.id), eq(R.trackerDate, localDate(now, tz)), eq(R.trigger, 'scheduled')));
      if (today.some((r) => r.status !== 'failed')) continue;                       // done, skipped, or in flight
      if (today.filter((r) => r.status === 'failed').length >= MAX_SCHEDULED_ATTEMPTS) continue;
      try { await this.runSchedule(s.id, { trigger: 'scheduled', now }); ran.push(s.id); }
      catch (err) { console.error(`[daily-tracker] ${s.id}: ${err.message}`); }
    }
    return ran;
  }
}

module.exports = new DailyTrackersService();
module.exports.DEFAULT_COLUMNS = DEFAULT_COLUMNS;
