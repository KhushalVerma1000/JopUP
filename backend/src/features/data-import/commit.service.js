/**
 * Committing a reviewed batch, and undoing it.
 *
 * Shape of a commit
 *   start   once: checks, plan limits, then creates the clients / locations /
 *           positions the rows need (one transaction) and records them in the ledger.
 *   next    repeatedly (the browser calls it until finished): takes the next 200
 *           pending rows under a lock; each row is its own savepoint, so one bad row
 *           is recorded as failed and the rest carry on. Safe to repeat after a crash:
 *           finished rows are never touched again.
 *   finish  automatically after the last row: optional "already mailed" log, totals, audit.
 *
 * What it deliberately does NOT do: emit events, run automation rules, send mail
 * or spend credits. The rows are history; nothing should react to them.
 */
const { eq, and, inArray, sql, asc, gt } = require('drizzle-orm');
const { db, schema } = require('../../utils/db');
const ent = require('../../utils/entitlements');
const { canActOnTeam, visibleTeamIds } = require('../../utils/teamScope');
const { auditWrite } = require('../../utils/audit');
const { AppError, BadRequestError, ForbiddenError } = require('../../utils/errors');
const { localDate, startOfLocalDay } = require('../../utils/zonedTime');
const { matchLocation } = require('../mail/locationMatch');
const base = require('./data-import.service');
const { buildStageLogs, mailLogGroups, candidateCustomFields } = require('./commit');

const CHUNK_ROWS = Number(process.env.DATA_IMPORT_CHUNK) || 200;   // the env override exists so tests can exercise several chunks
const COMMIT_DAYS = 3;     // time allowed to finish the chunks
const UNDO_DAYS = 14;      // how long after finishing an import can be undone (and rows are kept)
const LIVE = ['active', 'on_hold'];
const R = schema.importRow;
const B = schema.importBatch;

const ownerOf = (user, b) => user.userId || b.createdBy;

async function assertLimits(orgId, adds) {
  const ctx = await ent.loadOrgContext(orgId);
  if (!ctx) return;
  for (const [key, n] of Object.entries(adds)) {
    const def = ent.LIMITS[key]; const limit = ((ctx.plan && ctx.plan.limits) || {})[key];
    if (!n || ent.isUnlimited(limit)) continue;
    const r = ent.checkLimit(limit, await def.count(orgId), n);
    if (r.ok) continue;
    const planName = ctx.plan ? ctx.plan.name : 'current';
    throw new AppError(r.remaining > 0
      ? `Your ${planName} plan has room for ${r.remaining} more ${def.label}, but this import adds ${n}. Skip some rows or upgrade.`
      : `You have reached the ${def.label} limit (${r.limit}) on your ${planName} plan. Upgrade to import these.`,
    403, { code: 'PLAN_LIMIT', limitKey: key, limit: r.limit, current: r.current, remaining: r.remaining, requested: n });
  }
}

// ── start ────────────────────────────────────────────────────────────────────

async function startCommit(user, orgId, id, body = {}) {
  const batch = await base.loadBatch(user, orgId, id);
  if (batch.status === 'importing') throw new AppError('This import is already running. Keep calling /commit/next until it finishes.', 409);
  if (batch.status !== 'previewed') throw new AppError(`This import is ${batch.status} and cannot be started.`, 409);
  if (!canActOnTeam(user, batch.teamId, 'candidates', 'write') || !canActOnTeam(user, batch.teamId, 'trackers', 'write')) {
    throw new ForbiddenError("You need candidate and tracker write access in this team to import");
  }
  const s = batch.summary;
  if (!s.rows.import) throw new BadRequestError('There is nothing to import: every row is skipped or blocked.');
  if (s.rows.blocked > 0 && !body.skipBlocked) {
    throw new AppError(`${s.rows.blocked} row(s) cannot be imported (missing name, or something you are not allowed to create). Fix them, or confirm you want them left out.`, 409, { code: 'BLOCKED_ROWS', blocked: s.rows.blocked });
  }

  const plans = (await db.select({ plan: R.plan }).from(R).where(and(eq(R.batchId, batch.id), sql`${R.plan}->>'action' = 'import'`))).map((r) => r.plan);
  const used = { clients: new Set(), locations: new Set(), positions: new Set() };
  const newPeople = new Set();
  for (const p of plans) {
    if (p.candidateAction === 'create') newPeople.add(p.candidateKey);
    if (p.tracker && p.tracker.action === 'create') {
      if (p.clientKey) used.clients.add(p.clientKey);
      if (p.locationKey) used.locations.add(p.locationKey);
      if (p.positionKey) used.positions.add(p.positionKey);
    }
  }
  const E = batch.entities;
  const newClients = E.clients.filter((c) => used.clients.has(c.key) && c.decision.action === 'create' && !c.blocked).length;
  await assertLimits(orgId, { max_candidates: newPeople.size, max_clients: newClients });

  const actor = ownerOf(user, batch);
  const ledger = { clients: {}, locations: {}, positions: {}, mailLogs: [] };
  const updated = await db.transaction(async (tx) => {
    const exists = async (table, where, what) => {
      const [row] = await tx.select({ id: table.id }).from(table).where(where);
      if (!row) throw new AppError(`${what} you matched no longer exists. Run the preview again.`, 409);
      return row.id;
    };
    for (const e of E.clients.filter((c) => used.clients.has(c.key))) {
      if (e.decision.action === 'use_existing') {
        ledger.clients[e.key] = { id: await exists(schema.client, and(eq(schema.client.id, e.decision.clientId), eq(schema.client.organisationId, orgId)), 'A client'), created: false };
      } else if (!e.blocked) {
        const [c] = await tx.insert(schema.client).values({ organisationId: orgId, ownerTeamId: batch.teamId, createdBy: actor, companyName: e.label, status: 'active', notes: `Created by import of ${batch.fileName}` }).returning({ id: schema.client.id });
        ledger.clients[e.key] = { id: c.id, created: true };
      }
    }
    for (const e of E.locations.filter((l) => used.locations.has(l.key))) {
      const clientId = (ledger.clients[e.clientKey] || {}).id; if (!clientId) continue;
      if (e.decision.action === 'use_existing') {
        ledger.locations[e.key] = { id: await exists(schema.clientLocation, and(eq(schema.clientLocation.id, e.decision.locationId), eq(schema.clientLocation.organisationId, orgId)), 'A hiring location'), created: false };
      } else if (!e.blocked) {
        const [l] = await tx.insert(schema.clientLocation).values({ organisationId: orgId, clientId, createdBy: actor, name: e.label, aliases: [] }).returning({ id: schema.clientLocation.id });
        ledger.locations[e.key] = { id: l.id, created: true };
      }
    }
    for (const e of E.positions.filter((p) => used.positions.has(p.key))) {
      const clientId = (ledger.clients[e.clientKey] || {}).id;
      if (!clientId || e.decision.action === 'none') continue;
      if (e.decision.action === 'use_existing') {
        ledger.positions[e.key] = { id: await exists(schema.openPosition, and(eq(schema.openPosition.id, e.decision.positionId), eq(schema.openPosition.organisationId, orgId), eq(schema.openPosition.status, 'open')), 'An open position'), created: false };
      } else if (!e.blocked) {
        const [p] = await tx.insert(schema.openPosition).values({ organisationId: orgId, teamId: batch.teamId, clientId, createdBy: actor, designation: e.designation, location: e.location || null, vacancies: 1, status: 'open', notes: `Created by import of ${batch.fileName}` }).returning({ id: schema.openPosition.id });
        ledger.positions[e.key] = { id: p.id, created: true };
      }
    }
    const [b] = await tx.update(B).set({
      status: 'importing', startedAt: new Date(), ledger,
      commitOptions: { alreadyMailed: Boolean(body.options && body.options.alreadyMailed), useJobLocationForMail: !(body.options && body.options.useJobLocationForMail === false) },
      expiresAt: new Date(Date.now() + COMMIT_DAYS * 86400000), updatedAt: new Date(),
    }).where(eq(B.id, batch.id)).returning();
    await auditWrite(orgId, user.userId, 'import_start', 'import_batch', batch.id, null, { file: batch.fileName, rows: s.rows, candidates: s.candidates }, 'data_import');
    return b;
  });
  return base.present(updated);
}

// ── next ─────────────────────────────────────────────────────────────────────

async function findExistingCandidate(tx, orgId, c) {
  const conds = [];
  if (c.phoneNormalized) conds.push(eq(schema.candidate.phoneNormalized, c.phoneNormalized));
  if (c.email) conds.push(sql`lower(${schema.candidate.email}) = ${String(c.email).toLowerCase()}`);
  if (!conds.length) return null;
  const [hit] = await tx.select({ id: schema.candidate.id, ownerTeamId: schema.candidate.ownerTeamId }).from(schema.candidate)
    .where(and(eq(schema.candidate.organisationId, orgId), conds.length > 1 ? sql`(${conds[0]} or ${conds[1]})` : conds[0])).limit(1);
  return hit || null;
}

async function applyRow(tx, ctx, batch, row) {
  const { plan, data } = row;
  if (plan.action !== 'import') return { skipped: true, reason: plan.action };
  const orgId = batch.organisationId;
  const c = data.candidate; const t = plan.tracker;
  const result = {};

  // — the candidate —
  let candidateId = ctx.candidateIds.get(plan.candidateKey) || null;
  if (!candidateId) {
    const [prev] = await tx.select({ r: R.result }).from(R).where(and(eq(R.batchId, batch.id), eq(R.status, 'done'),
      sql`${R.plan}->>'candidateKey' = ${plan.candidateKey}`, sql`${R.result}->>'candidateId' is not null`)).limit(1);
    if (prev) candidateId = prev.r.candidateId;
  }
  if (candidateId) { result.candidateId = candidateId; result.candidateCreated = false; }
  else {
    if (plan.candidateAction === 'skip') return { skipped: true, reason: 'candidate_skipped' };
    let existingId = null;
    if (['use_existing', 'fill_empty'].includes(plan.candidateAction) && plan.existingCandidate) {
      const [e] = await tx.select({ id: schema.candidate.id }).from(schema.candidate).where(and(eq(schema.candidate.id, plan.existingCandidate.id), eq(schema.candidate.organisationId, orgId)));
      existingId = e ? e.id : null;
    }
    if (!existingId) { // someone may have added them since the preview
      const found = await findExistingCandidate(tx, orgId, c);
      if (found) {
        const teams = visibleTeamIds(ctx.user);
        if (teams !== null && !teams.includes(found.ownerTeamId)) throw new Error('This candidate already exists in a team you cannot see');
        existingId = found.id; result.matchedAtImport = true;
      }
    }
    if (existingId) {
      candidateId = existingId; result.candidateCreated = false;
      if (plan.candidateAction === 'fill_empty') {
        const [cur] = await tx.select().from(schema.candidate).where(eq(schema.candidate.id, existingId));
        const patch = {}; const before = {};
        for (const [col, val] of [['email', c.email], ['location', c.location || (t && t.locationName)], ['phone', c.phone]]) {
          if (val && !cur[col]) { patch[col] = val; before[col] = null; }
        }
        if (patch.phone) { patch.phoneCountry = c.phoneCountry; patch.phoneNormalized = c.phoneNormalized; }
        if (Object.keys(patch).length) {
          await tx.update(schema.candidate).set({ ...patch, updatedAt: new Date() }).where(eq(schema.candidate.id, existingId));
          result.filled = Object.keys(before); result.before = before;
        }
      }
    } else {
      if (!c.firstName) throw new Error('No name for a new candidate');
      const jobLocation = ctx.options.useJobLocationForMail && data.tracker ? data.tracker.locationName : null;
      const [n] = await tx.insert(schema.candidate).values({
        organisationId: orgId, ownerTeamId: batch.teamId, createdBy: batch.createdBy,
        firstName: c.firstName, lastName: c.lastName || null, email: c.email || null,
        phone: c.phone || null, phoneCountry: c.phoneCountry || null, phoneNormalized: c.phoneNormalized || null,
        location: c.location || jobLocation || null,
        source: 'import', sourceRef: `import:${batch.id}`, skills: c.skills || [],
        customFields: candidateCustomFields(c, data.custom), status: 'active',
      }).returning({ id: schema.candidate.id });
      candidateId = n.id; result.candidateCreated = true;
      if (!c.location && jobLocation) result.locationFromJob = true;
    }
    result.candidateId = candidateId;
  }
  ctx.candidateIds.set(plan.candidateKey, candidateId);

  // — the tracker —
  if (t && t.action === 'create') {
    const positionId = plan.positionKey && ctx.ledger.positions[plan.positionKey] ? ctx.ledger.positions[plan.positionKey].id : null;
    result.positionId = positionId;
    if (LIVE.includes(t.status) && positionId) {
      const [live] = await tx.select({ id: schema.candidateTracker.id }).from(schema.candidateTracker).where(and(eq(schema.candidateTracker.candidateId, candidateId),
        eq(schema.candidateTracker.openPositionId, positionId), inArray(schema.candidateTracker.status, LIVE))).limit(1);
      if (live) { result.trackerSkipped = 'already_live'; return result; }
    }
    const built = buildStageLogs({ stages: ctx.stages, targetKey: t.stageKey, status: t.status, reason: t.reason,
      dates: { lineup: t.lineupDate, interview: t.interviewDate, joining: t.joiningDate }, tz: ctx.tz, now: ctx.now, movedBy: batch.createdBy, note: `Imported from ${batch.fileName}` });
    const [tr] = await tx.insert(schema.candidateTracker).values({
      organisationId: orgId, teamId: batch.teamId, candidateId, openPositionId: positionId, workflowTemplateId: ctx.templateId,
      assignedHr: t.assignedHr || batch.createdBy, status: built.status, notes: t.remarks || null,
      lineupDate: t.lineupDate ? startOfLocalDay(t.lineupDate, ctx.tz) : null, interviewDate: t.interviewDate ? startOfLocalDay(t.interviewDate, ctx.tz) : null,
      createdAt: built.firstAt, updatedAt: built.lastAt,
    }).returning({ id: schema.candidateTracker.id });
    await tx.insert(schema.candidateTrackerStageLog).values(built.logs.map((l) => ({
      trackerId: tr.id, stageId: l.stageId, movedBy: l.movedBy, status: l.status, blockReason: l.blockReason, notes: l.notes,
      enteredAt: l.enteredAt, exitedAt: l.exitedAt, stageData: { imported: true, batch: batch.id },
    })));
    result.trackerId = tr.id; result.trackerCreated = true; result.trackerStatus = built.status;
    if (built.downgraded) result.downgraded = 'placed → active (the pipeline has no final stage)';
  }
  return result;
}

async function finish(tx, batch, ctx) {
  const orgId = batch.organisationId;
  const created = await tx.select({ plan: R.plan, result: R.result }).from(R).where(and(eq(R.batchId, batch.id), eq(R.status, 'done'), sql`${R.result}->>'trackerCreated' = 'true'`));
  const ledger = { ...batch.ledger, mailLogs: [] };

  if (ctx.options.alreadyMailed && created.length) {
    const ids = created.map((r) => r.result.trackerId);
    const trackers = await tx.select({ id: schema.candidateTracker.id, status: schema.candidateTracker.status, lineupDate: schema.candidateTracker.lineupDate, interviewDate: schema.candidateTracker.interviewDate, location: schema.candidate.location })
      .from(schema.candidateTracker).innerJoin(schema.candidate, eq(schema.candidate.id, schema.candidateTracker.candidateId)).where(inArray(schema.candidateTracker.id, ids));
    const byId = new Map(trackers.map((t) => [t.id, t]));
    const clientOf = new Map(created.map((r) => [r.result.trackerId, (ctx.ledger.clients[r.plan.clientKey] || {}).id || null]));
    const clientIds = [...new Set([...clientOf.values()].filter(Boolean))];
    const locs = clientIds.length ? await tx.select().from(schema.clientLocation).where(and(eq(schema.clientLocation.organisationId, orgId), inArray(schema.clientLocation.clientId, clientIds))) : [];
    const items = [];
    for (const [trackerId, clientId] of clientOf) {
      const t = byId.get(trackerId); if (!t || !clientId || !LIVE.includes(t.status)) continue;
      items.push({ trackerId, clientId, locationId: matchLocation(t.location, locs.filter((l) => l.clientId === clientId)) || null,
        lineupDay: t.lineupDate ? localDate(new Date(t.lineupDate), ctx.tz) : null, interviewDay: t.interviewDate ? localDate(new Date(t.interviewDate), ctx.tz) : null });
    }
    const label = { lineup: 'Lineup', interview_schedule: 'Interview schedule' };
    for (const g of mailLogGroups(items, localDate(ctx.now, ctx.tz))) {
      const [log] = await tx.insert(schema.clientMailLog).values({ organisationId: orgId, clientId: g.clientId, locationId: g.locationId, sentBy: batch.createdBy, mailType: g.mailType,
        subject: `Already sent before import: ${label[g.mailType]} for ${g.day}`, toEmails: [], ccEmails: [], trackerIds: g.trackerIds, candidateCount: g.trackerIds.length }).returning({ id: schema.clientMailLog.id });
      ledger.mailLogs.push(log.id);
    }
  }

  const prog = await base.progressOf(batch.id);
  const rows = await tx.select({ result: R.result }).from(R).where(and(eq(R.batchId, batch.id), eq(R.status, 'done'))).orderBy(asc(R.seq));
  const tally = { candidatesCreated: 0, candidatesReused: 0, trackersCreated: 0, trackersSkipped: 0, clientsCreated: 0, locationsCreated: 0, positionsCreated: 0, mailLogs: ledger.mailLogs.length, downgraded: 0 };
  const people = new Map(); // candidate id -> created by this import (any of their rows says so)
  for (const r of rows) {
    const x = r.result || {};
    if (x.candidateId) people.set(x.candidateId, Boolean(people.get(x.candidateId) || x.candidateCreated));
    if (x.trackerCreated) tally.trackersCreated += 1;
    if (x.trackerSkipped) tally.trackersSkipped += 1;
    if (x.downgraded) tally.downgraded += 1;
  }
  for (const made of people.values()) { if (made) tally.candidatesCreated += 1; else tally.candidatesReused += 1; }
  for (const k of ['clients', 'locations', 'positions']) tally[`${k}Created`] = Object.values(ledger[k]).filter((e) => e.created).length;
  const result = { ...tally, rows: { done: prog.done, skipped: prog.skipped, failed: prog.failed } };
  const now = new Date();
  const [b] = await tx.update(B).set({ status: 'done', finishedAt: now, ledger, result, expiresAt: new Date(now.getTime() + (UNDO_DAYS + 1) * 86400000), updatedAt: now }).where(eq(B.id, batch.id)).returning();
  await auditWrite(orgId, batch.createdBy, 'import_finish', 'import_batch', batch.id, null, result, 'data_import');
  return b;
}

async function commitNext(user, orgId, id) {
  const probe = await base.loadBatch(user, orgId, id);
  if (probe.status !== 'importing') throw new AppError(probe.status === 'done' ? 'This import has already finished.' : `This import is ${probe.status}; start it first.`, 409);
  const out = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from import_batch where id = ${probe.id} for update`); // one worker at a time
    const [batch] = await tx.select().from(B).where(eq(B.id, probe.id));
    if (batch.status !== 'importing') throw new AppError('This import has already finished.', 409);
    const [org] = await tx.select({ tz: schema.organisation.timezone }).from(schema.organisation).where(eq(schema.organisation.id, orgId));
    const stages = await tx.select({ id: schema.workflowStage.id, stageKey: schema.workflowStage.stageKey, orderIndex: schema.workflowStage.orderIndex, isFinalSuccess: schema.workflowStage.isFinalSuccess })
      .from(schema.workflowStage).where(eq(schema.workflowStage.workflowTemplateId, batch.options.workflowTemplateId));
    const ctx = { user, stages, templateId: batch.options.workflowTemplateId, tz: (org && org.tz) || 'UTC', now: new Date(), ledger: batch.ledger, options: batch.commitOptions || {}, candidateIds: new Map() };

    const rows = await tx.select().from(R).where(and(eq(R.batchId, batch.id), eq(R.status, 'pending'))).orderBy(asc(R.seq)).limit(CHUNK_ROWS);
    for (const row of rows) {
      try {
        const result = await tx.transaction((sp) => applyRow(sp, ctx, batch, row));
        await tx.update(R).set({ status: result.skipped ? 'skipped' : 'done', result }).where(eq(R.id, row.id));
      } catch (err) {
        await tx.update(R).set({ status: 'failed', error: String(err.message).slice(0, 500) }).where(eq(R.id, row.id));
      }
    }
    const [{ n }] = await tx.select({ n: sql`count(*)::int` }).from(R).where(and(eq(R.batchId, batch.id), eq(R.status, 'pending')));
    return n === 0 ? finish(tx, batch, ctx) : batch;
  });
  return base.present(out);
}

// ── undo ─────────────────────────────────────────────────────────────────────

/**
 * Removes what the import created and nobody has touched since. Anything edited,
 * advanced, mailed or tagged afterwards stays and is reported, so an undo can
 * never destroy work HR did on top of imported data.
 */
async function undoBatch(user, orgId, id) {
  const batch = await base.loadBatch(user, orgId, id);
  if (batch.status !== 'done') throw new AppError(batch.status === 'undone' ? 'This import was already undone.' : 'Only a finished import can be undone.', 409);
  if (Date.now() - new Date(batch.finishedAt).getTime() > UNDO_DAYS * 86400000) throw new AppError(`Imports can only be undone within ${UNDO_DAYS} days.`, 409);
  if (!canActOnTeam(user, batch.teamId, 'candidates', 'write') || !canActOnTeam(user, batch.teamId, 'trackers', 'write')) throw new ForbiddenError('You need candidate and tracker write access in this team to undo an import');
  const fin = new Date(batch.finishedAt);
  const kept = { trackers: 0, candidates: 0, positions: 0, locations: 0, clients: 0, filled: 0 };
  const removed = { trackers: 0, candidates: 0, positions: 0, locations: 0, clients: 0, mailLogs: 0, restored: 0 };
  const ledger = batch.ledger || {};

  const out = await db.transaction(async (tx) => {
    const rows = await tx.select({ result: R.result }).from(R).where(and(eq(R.batchId, batch.id), eq(R.status, 'done')));
    const attempt = async (fn) => { try { await tx.transaction(fn); return true; } catch { return false; } };

    // mail logs the import wrote
    if ((ledger.mailLogs || []).length) { await tx.delete(schema.clientMailLog).where(inArray(schema.clientMailLog.id, ledger.mailLogs)); removed.mailLogs = ledger.mailLogs.length; }

    // trackers: only if nothing has happened since
    const tIds = rows.filter((r) => r.result.trackerCreated).map((r) => r.result.trackerId);
    if (tIds.length) {
      const trackers = await tx.select({ id: schema.candidateTracker.id, updatedAt: schema.candidateTracker.updatedAt }).from(schema.candidateTracker).where(inArray(schema.candidateTracker.id, tIds));
      const moved = new Set((await tx.select({ id: schema.candidateTrackerStageLog.trackerId }).from(schema.candidateTrackerStageLog).where(and(inArray(schema.candidateTrackerStageLog.trackerId, tIds), gt(schema.candidateTrackerStageLog.enteredAt, fin)))).map((r) => r.id));
      const acted = new Set((await tx.select({ id: schema.candidateTrackerStageLog.trackerId }).from(schema.candidateTrackerAction).innerJoin(schema.candidateTrackerStageLog, eq(schema.candidateTrackerStageLog.id, schema.candidateTrackerAction.stageLogId)).where(inArray(schema.candidateTrackerStageLog.trackerId, tIds))).map((r) => r.id));
      const free = trackers.filter((t) => t.updatedAt <= fin && !moved.has(t.id) && !acted.has(t.id)).map((t) => t.id);
      if (free.length) await tx.delete(schema.candidateTracker).where(inArray(schema.candidateTracker.id, free));
      removed.trackers = free.length; kept.trackers = tIds.length - free.length;
    }

    // fields filled on existing candidates: restore only if still as the import left them
    for (const r of rows.filter((x) => x.result.before)) {
      const [cur] = await tx.select().from(schema.candidate).where(eq(schema.candidate.id, r.result.candidateId));
      if (!cur) continue;
      const back = {}; for (const col of Object.keys(r.result.before)) if (cur[col]) back[col] = null;
      if (Object.keys(back).length && cur.updatedAt <= fin) { await tx.update(schema.candidate).set(back).where(eq(schema.candidate.id, cur.id)); removed.restored += 1; } else kept.filled += 1;
    }

    // candidates the import created: gone only if untouched and no longer in anyone's pipeline
    const cIds = [...new Set(rows.filter((r) => r.result.candidateCreated).map((r) => r.result.candidateId))];
    for (const cid of cIds) {
      const gone = await attempt(async (sp) => {
        const [c] = await sp.select({ updatedAt: schema.candidate.updatedAt }).from(schema.candidate).where(eq(schema.candidate.id, cid));
        const [{ n }] = await sp.select({ n: sql`count(*)::int` }).from(schema.candidateTracker).where(eq(schema.candidateTracker.candidateId, cid));
        if (!c || n > 0 || c.updatedAt > fin) throw new Error('keep');
        await sp.delete(schema.candidate).where(eq(schema.candidate.id, cid));
      });
      if (gone) removed.candidates += 1; else kept.candidates += 1;
    }

    // positions, locations, clients: only the ones the import created, only when nothing else depends on them
    for (const e of Object.values(ledger.positions || {}).filter((x) => x.created)) {
      const ok = await attempt(async (sp) => {
        const [p] = await sp.select({ updatedAt: schema.openPosition.updatedAt }).from(schema.openPosition).where(eq(schema.openPosition.id, e.id));
        const [{ n }] = await sp.select({ n: sql`count(*)::int` }).from(schema.candidateTracker).where(eq(schema.candidateTracker.openPositionId, e.id));
        if (!p) return; if (n > 0 || p.updatedAt > fin) throw new Error('keep');
        await sp.delete(schema.openPosition).where(eq(schema.openPosition.id, e.id));
      });
      if (ok) removed.positions += 1; else kept.positions += 1;
    }
    for (const e of Object.values(ledger.locations || {}).filter((x) => x.created)) {
      const ok = await attempt(async (sp) => {
        const [{ n }] = await sp.select({ n: sql`count(*)::int` }).from(schema.clientSpoc).where(eq(schema.clientSpoc.locationId, e.id));
        if (n > 0) throw new Error('keep');
        await sp.delete(schema.clientLocation).where(eq(schema.clientLocation.id, e.id));
      });
      if (ok) removed.locations += 1; else kept.locations += 1;
    }
    for (const e of Object.values(ledger.clients || {}).filter((x) => x.created)) {
      const ok = await attempt(async (sp) => {
        const [c] = await sp.select({ updatedAt: schema.client.updatedAt }).from(schema.client).where(eq(schema.client.id, e.id));
        const cnt = async (table, col) => (await sp.select({ n: sql`count(*)::int` }).from(table).where(eq(col, e.id)))[0].n;
        const dependants = (await cnt(schema.openPosition, schema.openPosition.clientId)) + (await cnt(schema.clientSpoc, schema.clientSpoc.clientId))
          + (await cnt(schema.clientLocation, schema.clientLocation.clientId)) + (await cnt(schema.clientMailLog, schema.clientMailLog.clientId));
        if (!c) return; if (dependants > 0 || c.updatedAt > fin) throw new Error('keep');
        await sp.delete(schema.client).where(eq(schema.client.id, e.id));
      });
      if (ok) removed.clients += 1; else kept.clients += 1;
    }

    const now = new Date();
    const [b] = await tx.update(B).set({ status: 'undone', undoneAt: now, result: { ...batch.result, undo: { removed, kept } }, updatedAt: now }).where(eq(B.id, batch.id)).returning();
    await auditWrite(orgId, user.userId, 'import_undo', 'import_batch', batch.id, null, { removed, kept }, 'data_import');
    return b;
  });
  return base.present(out, { undo: { removed, kept } });
}

module.exports = { startCommit, commitNext, undoBatch, CHUNK_ROWS, UNDO_DAYS };
