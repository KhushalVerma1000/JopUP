const crypto = require('crypto');
const { eq, and, or, inArray, sql, asc, ne, lt, gt } = require('drizzle-orm');
const { db, schema } = require('../../utils/db');
const ent = require('../../utils/entitlements');
const { visibleTeamIds, canSeeTeam, canActOnTeam } = require('../../utils/teamScope');
const { NotFoundError, ForbiddenError, BadRequestError, AppError } = require('../../utils/errors');
const { readWorkbook } = require('./reader');
const { analyseWorkbook } = require('./analyse');
const { buildPlan } = require('./match');

const PREVIEW_ROWS = 25;
const BATCH_DAYS = 7;           // staged rows hold personal data: keep them a week, then purge
const INSERT_CHUNK = 500;
const IN_CHUNK = 1000;

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

/** The org's own country is the right default for bare phone numbers; a request may override it. */
async function orgDefaultCountry(orgId) {
  const [org] = await db.select({ c: schema.organisation.defaultCountry }).from(schema.organisation)
    .where(eq(schema.organisation.id, orgId));
  return org && org.c ? org.c : null;
}

/** Read and analyse one file. Nothing is saved: the mapping step of the wizard. */
async function analyseFile(file, orgId, opts = {}) {
  const { sheets, truncated } = await readWorkbook(file.buffer, file.originalname);
  const defaultCountry = opts.defaultCountry || await orgDefaultCountry(orgId);
  const result = analyseWorkbook(sheets, { ...opts, defaultCountry });
  return {
    fileName: file.originalname,
    truncated,
    defaultCountry,
    totals: result.totals,
    sheets: result.sheets.map(({ records, ...s }) => ({
      ...s,
      preview: records.slice(0, PREVIEW_ROWS),
      issueRows: records.filter((r) => r.issues.some((i) => i.level !== 'info')).length,
    })),
  };
}

// ── what already exists, as far as this person may see it ────────────────────

async function loadCatalog(user, orgId, teamId, sheets) {
  const records = sheets.flatMap((s) => s.records);

  // clients this team can use: its own, org-wide shared ones, and ones granted to it
  const granted = await db.select({ id: schema.clientTeamAccess.clientId }).from(schema.clientTeamAccess)
    .where(eq(schema.clientTeamAccess.teamId, teamId));
  const grantedIds = granted.map((g) => g.id);
  const clients = await db.select({ id: schema.client.id, companyName: schema.client.companyName }).from(schema.client)
    .where(and(eq(schema.client.organisationId, orgId), or(
      eq(schema.client.ownerTeamId, teamId), eq(schema.client.sharedOrgWide, true),
      grantedIds.length ? inArray(schema.client.id, grantedIds) : sql`false`)));
  const clientIds = clients.map((c) => c.id);

  const locations = clientIds.length ? await db.select({ id: schema.clientLocation.id, clientId: schema.clientLocation.clientId, name: schema.clientLocation.name, aliases: schema.clientLocation.aliases })
    .from(schema.clientLocation).where(and(eq(schema.clientLocation.organisationId, orgId), inArray(schema.clientLocation.clientId, clientIds))) : [];
  const positions = clientIds.length ? await db.select({ id: schema.openPosition.id, clientId: schema.openPosition.clientId, designation: schema.openPosition.designation, location: schema.openPosition.location, status: schema.openPosition.status })
    .from(schema.openPosition).where(and(eq(schema.openPosition.organisationId, orgId), inArray(schema.openPosition.clientId, clientIds))) : [];
  const users = await db.select({ id: schema.user.id, firstName: schema.user.firstName, lastName: schema.user.lastName, email: schema.user.email })
    .from(schema.user).where(and(eq(schema.user.organisationId, orgId), eq(schema.user.status, 'active')));

  // candidates already in the database: only those whose phone or email appears in the file
  const phones = [...new Set(records.map((r) => r.candidate.phoneNormalized).filter(Boolean))];
  const emails = [...new Set(records.map((r) => r.candidate.email && r.candidate.email.toLowerCase()).filter(Boolean))];
  const found = [];
  for (const part of chunk(phones, IN_CHUNK)) {
    found.push(...await db.select().from(schema.candidate).where(and(eq(schema.candidate.organisationId, orgId), inArray(schema.candidate.phoneNormalized, part))));
  }
  for (const part of chunk(emails, IN_CHUNK)) {
    found.push(...await db.select().from(schema.candidate).where(and(eq(schema.candidate.organisationId, orgId), inArray(sql`lower(${schema.candidate.email})`, part))));
  }
  const unique = [...new Map(found.map((c) => [c.id, c])).values()];

  // …of which this person may see only their own teams' (and shared ones)
  const teams = visibleTeamIds(user);
  let seeable = unique;
  if (teams !== null && unique.length) {
    const shared = await db.select({ id: schema.candidateTeamAccess.candidateId }).from(schema.candidateTeamAccess)
      .where(and(inArray(schema.candidateTeamAccess.candidateId, unique.map((c) => c.id)), teams.length ? inArray(schema.candidateTeamAccess.teamId, teams) : sql`false`));
    const sharedIds = new Set(shared.map((s) => s.id));
    seeable = unique.filter((c) => teams.includes(c.ownerTeamId) || sharedIds.has(c.id));
  }
  const seeableIds = new Set(seeable.map((c) => c.id));
  const hidden = unique.filter((c) => !seeableIds.has(c.id));

  const liveTags = seeable.length ? await db.select({ candidateId: schema.candidateTracker.candidateId, openPositionId: schema.candidateTracker.openPositionId })
    .from(schema.candidateTracker).where(and(inArray(schema.candidateTracker.candidateId, seeable.map((c) => c.id)),
      inArray(schema.candidateTracker.status, ['active', 'on_hold']), sql`${schema.candidateTracker.openPositionId} is not null`)) : [];

  // the destination team's own pipeline decides which stages exist
  const [tpl] = await db.select().from(schema.workflowTemplate)
    .where(and(eq(schema.workflowTemplate.teamId, teamId), eq(schema.workflowTemplate.isDefault, true)));
  if (!tpl) throw new BadRequestError('This team has no default workflow yet, so there are no stages to import into. Set one up first.');
  const stages = await db.select({ stageKey: schema.workflowStage.stageKey, name: schema.workflowStage.name, orderIndex: schema.workflowStage.orderIndex })
    .from(schema.workflowStage).where(eq(schema.workflowStage.workflowTemplateId, tpl.id)).orderBy(asc(schema.workflowStage.orderIndex));

  return {
    clients, locations, positions, users, candidates: seeable, liveTags, stages,
    hiddenPhones: hidden.map((c) => c.phoneNormalized).filter(Boolean),
    hiddenEmails: hidden.map((c) => c.email).filter(Boolean),
    workflowTemplateId: tpl.id,
    permissions: {
      createClients: canActOnTeam(user, teamId, 'clients', 'write'),
      createLocations: canActOnTeam(user, teamId, 'clients', 'write'),
      createPositions: canActOnTeam(user, teamId, 'open_positions', 'write'),
    },
  };
}

/** Where the plan stands against the plan's allowances, so HR trims before committing, not after. */
async function limitsFor(orgId, summary) {
  const ctx = await ent.loadOrgContext(orgId);
  const out = {};
  for (const [key, adding] of [['max_candidates', summary.newCandidateRows], ['max_clients', summary.clients.new]]) {
    const def = ent.LIMITS[key];
    const limit = ((ctx && ctx.plan && ctx.plan.limits) || {})[key];
    out[key] = { label: def.label, adding, ...ent.checkLimit(limit, ent.isUnlimited(limit) ? 0 : await def.count(orgId), adding) };
  }
  return out;
}

const compactSheet = (s) => ({ name: s.name, kind: s.kind, headerRow: s.headerRow, dateOrder: s.dateOrder, sheetDate: s.sheetDate, warnings: s.warnings,
  columns: s.columns.map(({ index, label, field, confidence, status, sample }) => ({ index, label, field, confidence, status, sample })), summary: s.summary });

const toRecord = (r) => ({ row: r.rowNumber, candidate: r.data.candidate, tracker: r.data.tracker, custom: r.data.custom, issues: r.data.analysisIssues || [], blocking: r.data.blocking, duplicateOfRow: r.data.duplicateOfRow });

function rowsForInsert(batchId, built, analysed) {
  const meta = new Map(); // `${sheet}:${row}` -> analysis extras
  analysed.forEach((s) => s.records.forEach((r) => meta.set(`${s.name}:${r.row}`, r)));
  return built.rows.map((r) => {
    const m = meta.get(`${r.sheetName}:${r.rowNumber}`) || {};
    return { batchId, seq: r.seq, sheetName: r.sheetName, rowNumber: r.rowNumber,
      data: { ...r.data, analysisIssues: m.issues || [], blocking: m.blocking || false, duplicateOfRow: m.duplicateOfRow || null },
      issues: r.issues, plan: r.plan, status: 'pending' };
  });
}

async function insertRows(tx, rows) { for (const part of chunk(rows, INSERT_CHUNK)) await tx.insert(schema.importRow).values(part); }

function authorise(user, batch) {
  if (!canSeeTeam(user, batch.teamId)) throw new NotFoundError('Import not found');
  if (batch.createdBy !== user.userId && visibleTeamIds(user) !== null) throw new NotFoundError('Import not found');
}

async function loadBatch(user, orgId, id) {
  const [batch] = await db.select().from(schema.importBatch).where(and(eq(schema.importBatch.id, id), eq(schema.importBatch.organisationId, orgId)));
  if (!batch) throw new NotFoundError('Import not found');
  authorise(user, batch);
  if (batch.expiresAt < new Date()) throw new AppError('This import has expired. Upload the file again.', 410);
  return batch;
}

async function present(batch, extra = {}) {
  return { id: batch.id, fileName: batch.fileName, status: batch.status, teamId: batch.teamId, expiresAt: batch.expiresAt, createdAt: batch.createdAt,
    options: batch.options, decisions: batch.decisions, summary: batch.summary, entities: batch.entities, limits: await limitsFor(batch.organisationId, batch.summary), ...extra };
}

/**
 * Analyse + match + stage. The file is read once; what is stored is the normalised
 * plan (never the original file). Re-uploading replaces nothing: each preview is its own batch.
 */
async function createPreview(user, orgId, file, { teamId, ...opts }) {
  if (!canActOnTeam(user, teamId, 'candidates', 'write')) throw new ForbiddenError("You can't import candidates into that team");
  const [team] = await db.select({ id: schema.team.id }).from(schema.team).where(and(eq(schema.team.id, teamId), eq(schema.team.organisationId, orgId)));
  if (!team) throw new NotFoundError('Team not found');

  const { sheets, truncated } = await readWorkbook(file.buffer, file.originalname);
  const defaultCountry = opts.defaultCountry || await orgDefaultCountry(orgId);
  const analysis = analyseWorkbook(sheets, { ...opts, defaultCountry });
  if (!analysis.totals.rows) throw new BadRequestError('No candidate rows were found in this file. Check that it has a heading row such as Name, Phone, Client.');

  const catalog = await loadCatalog(user, orgId, teamId, analysis.sheets);
  const built = buildPlan({ sheets: analysis.sheets, catalog, decisions: {}, opts: { now: new Date() } });
  const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const [previous] = await db.select({ id: schema.importBatch.id, createdAt: schema.importBatch.createdAt }).from(schema.importBatch)
    .where(and(eq(schema.importBatch.organisationId, orgId), eq(schema.importBatch.fileHash, fileHash), eq(schema.importBatch.status, 'done')));

  const expiresAt = new Date(Date.now() + BATCH_DAYS * 86400000);
  const batch = await db.transaction(async (tx) => {
    const [b] = await tx.insert(schema.importBatch).values({
      organisationId: orgId, teamId, createdBy: user.userId, fileName: file.originalname, fileHash, status: 'previewed',
      options: { defaultCountry, dateOrder: opts.dateOrder || null, statusOverrides: opts.statusOverrides || {}, mappingOverrides: opts.mappingOverrides || {}, truncated, sheets: analysis.sheets.map(compactSheet), workflowTemplateId: catalog.workflowTemplateId },
      entities: built.entities, summary: built.summary, expiresAt,
    }).returning();
    await insertRows(tx, rowsForInsert(b.id, built, analysis.sheets));
    return b;
  });
  return present(batch, { previouslyImported: previous || null, preview: built.rows.slice(0, PREVIEW_ROWS) });
}

async function getBatch(user, orgId, id) { return present(await loadBatch(user, orgId, id)); }

const FILTERS = {
  all: () => undefined,
  issues: () => sql`exists (select 1 from jsonb_array_elements(${schema.importRow.issues}) i where i->>'level' in ('error','warn'))`,
  errors: () => sql`${schema.importRow.issues} @> '[{"level":"error"}]'::jsonb`,
  blocked: () => sql`${schema.importRow.plan}->>'action' = 'blocked'`,
  skipped: () => sql`(${schema.importRow.plan}->>'action' = 'skip' or ${schema.importRow.plan}->'tracker'->>'action' = 'skip')`,
  existing: () => sql`${schema.importRow.plan} ? 'existingCandidate'`,
};

async function listRows(user, orgId, id, { filter = 'all', page = 1, limit = 50 } = {}) {
  const batch = await loadBatch(user, orgId, id);
  const make = FILTERS[filter]; if (!make) throw new BadRequestError(`filter must be one of: ${Object.keys(FILTERS).join(', ')}`);
  const cond = make(); const where = cond ? and(eq(schema.importRow.batchId, batch.id), cond) : eq(schema.importRow.batchId, batch.id);
  const [{ n }] = await db.select({ n: sql`count(*)::int` }).from(schema.importRow).where(where);
  const rows = await db.select({ seq: schema.importRow.seq, sheetName: schema.importRow.sheetName, rowNumber: schema.importRow.rowNumber, data: schema.importRow.data, issues: schema.importRow.issues, plan: schema.importRow.plan, status: schema.importRow.status })
    .from(schema.importRow).where(where).orderBy(asc(schema.importRow.seq)).limit(limit).offset((page - 1) * limit);
  return { total: n, page, limit, rows: rows.map((r) => ({ ...r, data: { candidate: r.data.candidate, tracker: r.data.tracker, custom: r.data.custom } })) };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
/** Merge HR's new answers over the earlier ones, one entity at a time; null clears an answer. */
function mergeDecisions(old, patch) {
  const out = { ...old };
  for (const [group, entries] of Object.entries(patch || {})) {
    if (!isObj(entries)) continue;
    out[group] = { ...(old[group] || {}) };
    for (const [k, v] of Object.entries(entries)) { if (v === null) delete out[group][k]; else out[group][k] = v; }
  }
  return out;
}

/** HR changes an answer (use this client, create that one, skip a row…): re-match from the stored rows. */
async function applyDecisions(user, orgId, id, patch) {
  const batch = await loadBatch(user, orgId, id);
  if (batch.status !== 'previewed') throw new AppError('This import has already started, so its plan can no longer be changed.', 409);
  const decisions = mergeDecisions(batch.decisions || {}, patch);
  const stored = await db.select().from(schema.importRow).where(eq(schema.importRow.batchId, batch.id)).orderBy(asc(schema.importRow.seq));
  const bySheet = new Map();
  stored.forEach((r) => { if (!bySheet.has(r.sheetName)) bySheet.set(r.sheetName, []); bySheet.get(r.sheetName).push(toRecord(r)); });
  const sheets = [...bySheet.entries()].map(([name, records]) => ({ name, records }));
  const catalog = await loadCatalog(user, orgId, batch.teamId, sheets);
  const built = buildPlan({ sheets, catalog, decisions, opts: { now: new Date() } });
  const analysed = sheets.map((s) => ({ name: s.name, records: s.records }));
  const updated = await db.transaction(async (tx) => {
    await tx.delete(schema.importRow).where(eq(schema.importRow.batchId, batch.id));
    await insertRows(tx, rowsForInsert(batch.id, built, analysed));
    const [b] = await tx.update(schema.importBatch).set({ decisions, entities: built.entities, summary: built.summary, updatedAt: new Date() }).where(eq(schema.importBatch.id, batch.id)).returning();
    return b;
  });
  return present(updated);
}

async function discardBatch(user, orgId, id) {
  const batch = await loadBatch(user, orgId, id);
  if (batch.status === 'importing') throw new AppError('This import is running and cannot be discarded.', 409);
  await db.delete(schema.importBatch).where(eq(schema.importBatch.id, batch.id));
}

/** For a scheduler: staged rows are personal data and are not kept past their expiry. */
async function purgeExpired(now = new Date()) {
  const gone = await db.delete(schema.importBatch).where(and(lt(schema.importBatch.expiresAt, now), ne(schema.importBatch.status, 'importing'))).returning({ id: schema.importBatch.id });
  return gone.length;
}

module.exports = { analyseFile, createPreview, getBatch, listRows, applyDecisions, discardBatch, purgeExpired, mergeDecisions, loadCatalog, PREVIEW_ROWS, BATCH_DAYS };
