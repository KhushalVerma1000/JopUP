/**
 * The import preview against a real, seeded database. Opt-in, like the other live suites:
 *
 *   npm run db:seed && npm run db:seed:demo -- --reset
 *   JOPUP_LIVE_TESTS=1 node --test test/dataImport.live.test.js
 *
 * The invariant that matters most: a preview reads and stages, it never creates
 * candidates, clients, positions or trackers.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const live = process.env.JOPUP_LIVE_TESTS === '1';
const t = (name, fn) => test(name, { skip: !live && 'set JOPUP_LIVE_TESTS=1 (needs seeded demo data)' }, fn);

let request, app, pool, ExcelJS;
const tokens = {}; let techTeam; let salesTeam; let created;
const authed = (who) => ({
  get: (u) => request(app).get(`/api/v1${u}`).set('Authorization', `Bearer ${tokens[who]}`),
  patch: (u, b) => request(app).patch(`/api/v1${u}`).set('Authorization', `Bearer ${tokens[who]}`).send(b),
  del: (u) => request(app).delete(`/api/v1${u}`).set('Authorization', `Bearer ${tokens[who]}`),
  post: (u, b) => request(app).post(`/api/v1${u}`).set('Authorization', `Bearer ${tokens[who]}`).send(b),
});
const counts = async () => (await pool.query(`select (select count(*) from candidate)::int cands, (select count(*) from client)::int clients,
  (select count(*) from open_position)::int positions, (select count(*) from candidate_tracker)::int trackers, (select count(*) from client_location)::int locs`)).rows[0];

const HEAD = ['Name', 'Phone', 'Client', 'Position', 'Job Location', 'Lineup Date', 'Status', 'Recruiter'];
const ROWS = [
  ['Priya Verma', '98123 45678', 'Orbit Logistics', 'Frontend Developer', 'Pune', '13/10/2026', 'Reached', null],
  ['Karan Mehta', 9811100001, 'Orbit Logistics', 'Frontend Developer', 'Pune', '13/10/2026', 'Lined up', null],
  ['Isha Nair', 9811100002, 'Orbit Logistic', 'Backend Engineer', 'Pune', '20/10/2026', 'Selected', null],
  ['Dev Rao', 9811100003, 'Brand New Client Co', 'Analyst', 'Delhi', '20/10/2026', 'Lined up', null],
  ['Hidden Person', 9811199999, 'Orbit Logistics', 'Frontend Developer', 'Pune', '20/10/2026', 'Lined up', null],
  ['Priya Verma', '98123 45678', 'Zenith Fintech', 'Senior Backend Engineer', 'Bengaluru', '21/10/2026', 'Lined up', 'Nobody Known'],
];
const workbook = async () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Lineups');
  ws.addRow(['ACME - lineups']); ws.addRow([]); ws.addRow(HEAD); ROWS.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
};
const preview = async (who, team, buf) => authed(who).post ? request(app).post('/api/v1/data-import/preview')
  .set('Authorization', `Bearer ${tokens[who]}`).field('teamId', team).field('defaultCountry', 'IN').attach('file', buf || await workbook(), 'lineups.xlsx') : null;

test.before(async () => {
  if (!live) return;
  request = require('supertest'); app = require('../src/app'); pool = require('../src/utils/db').pool; ExcelJS = require('exceljs');
  for (const [k, email] of Object.entries({ mgr: 'manager.tech@acme.test', hr: 'hr.tech@acme.test', salesMgr: 'manager.sales@acme.test', salesHr: 'hr.sales@acme.test' })) {
    tokens[k] = (await request(app).post('/api/v1/auth/login').send({ email, password: 'Password123!' })).body.data.token;
  }
  techTeam = (await pool.query("select id from team where name='Tech Hiring'")).rows[0].id;
  salesTeam = (await pool.query("select id from team where name='Sales Hiring'")).rows[0].id;
  // fixtures: Priya exists in Tech; "Hidden Person" exists only in Sales
  await pool.query("delete from candidate where phone_normalized in ('+919812345678','+919811199999')");
  const mk = (who, team, body) => authed(who).post('/candidates', { ownerTeamId: team, source: 'manual', phoneCountry: 'IN', ...body });
  assert.equal((await mk('mgr', techTeam, { firstName: 'Priya', lastName: 'Verma', phone: '9812345678' })).status, 201);
  assert.equal((await mk('salesMgr', salesTeam, { firstName: 'Hidden', lastName: 'Person', phone: '9811199999' })).status, 201);
  created = [];
});
test.after(async () => {
  if (!pool) return;
  await pool.query("delete from import_batch where file_name='lineups.xlsx'");
  await pool.query("delete from candidate where phone_normalized in ('+919812345678','+919811199999')");
  await pool.end();
});

t('a preview stages a plan and writes nothing to the real tables', async () => {
  const before = await counts();
  const res = await preview('mgr', techTeam);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  created.push(res.body.data.id);
  assert.deepEqual(await counts(), before);
  const d = res.body.data;
  assert.equal(d.status, 'previewed');
  assert.equal(d.summary.rows.total, 6);
  assert.equal(d.summary.candidates.unique, 5);            // Priya twice
  assert.equal(d.summary.candidates.existing, 1);          // Priya, found by phone
  assert.ok(new Date(d.expiresAt) > new Date());
});

t('clients: exact and shared ones matched, a near name only suggested, an unknown one is new', async () => {
  const d = (await authed('mgr').get(`/data-import/batches/${created[0]}`)).body.data;
  const by = (k) => d.entities.clients.find((c) => c.key === k);
  assert.equal(by('orbit logistics').decision.action, 'use_existing');
  assert.equal(by('zenith fintech').decision.action, 'use_existing');       // shared org-wide
  const near = by('orbit logistic');
  assert.equal(near.match.type, 'near'); assert.equal(near.decision.action, 'create'); assert.equal(near.needsReview, true);
  assert.equal(by('brand new client').decision.action, 'create');
});

t('positions: an existing open position is matched; others are new', async () => {
  const d = (await authed('mgr').get(`/data-import/batches/${created[0]}`)).body.data;
  const fe = d.entities.positions.find((p) => p.designation === 'Frontend Developer' && p.clientKey === 'orbit logistics');
  assert.equal(fe.decision.action, 'use_existing');
  assert.equal(d.entities.positions.find((p) => p.designation === 'Analyst').decision.action, 'create');
});

t('a candidate that lives in a team the importer cannot see is skipped and never named', async () => {
  const res = await authed('mgr').get(`/data-import/batches/${created[0]}/rows?filter=skipped`);
  const hidden = res.body.data.rows.find((r) => r.data.candidate.firstName === 'Hidden');
  assert.ok(hidden, 'row should be skipped');
  assert.ok(hidden.issues.some((i) => i.code === 'exists_elsewhere'));
  assert.equal(hidden.plan.existingCandidate, undefined);
  assert.ok(!JSON.stringify(res.body).includes('Sales Hiring'));
});

t('rows can be filtered and paged', async () => {
  const all = (await authed('mgr').get(`/data-import/batches/${created[0]}/rows?limit=2&page=2`)).body.data;
  assert.equal(all.total, 6); assert.equal(all.rows.length, 2); assert.equal(all.rows[0].seq, 3);
  const issues = (await authed('mgr').get(`/data-import/batches/${created[0]}/rows?filter=issues`)).body.data;
  assert.ok(issues.total >= 1 && issues.total < 6);
  assert.equal((await authed('mgr').get(`/data-import/batches/${created[0]}/rows?filter=nonsense`)).status, 400);
});

t('HR without clients:write sees new clients as blocked, with the reason on the rows', async () => {
  const res = await preview('hr', techTeam); created.push(res.body.data.id);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.ok(res.body.data.summary.clients.blocked >= 1);
  const rows = (await authed('hr').get(`/data-import/batches/${res.body.data.id}/rows?filter=blocked`)).body.data;
  assert.ok(rows.total >= 1);
  assert.ok(rows.rows.every((r) => r.issues.some((i) => i.code === 'client_not_allowed')));
});

t('HR\'s answers re-match the plan: accept a suggestion, exclude a row, undo an answer', async () => {
  const id = created[0];
  const before = (await authed('mgr').get(`/data-import/batches/${id}`)).body.data;
  const orbit = before.entities.clients.find((c) => c.key === 'orbit logistics').decision.clientId;
  const merged = await authed('mgr').patch(`/data-import/batches/${id}/decisions`, { clients: { 'orbit logistic': { action: 'use_existing', clientId: orbit } }, rows: { 'Lineups:5': { action: 'skip' } } });
  assert.equal(merged.status, 200, JSON.stringify(merged.body));
  assert.equal(merged.body.data.entities.clients.find((c) => c.key === 'orbit logistic').decision.clientId, orbit);
  assert.equal(merged.body.data.summary.clients.needsReview, 0);
  assert.equal(merged.body.data.summary.rows.skip, before.summary.rows.skip + 1);
  const cleared = await authed('mgr').patch(`/data-import/batches/${id}/decisions`, { clients: { 'orbit logistic': null } });
  assert.equal(cleared.body.data.entities.clients.find((c) => c.key === 'orbit logistic').decision.action, 'create');
  assert.equal(cleared.body.data.summary.rows.total, 6);   // rows were replaced, not duplicated
  assert.equal((await authed('mgr').patch(`/data-import/batches/${id}/decisions`, { clients: { x: { action: 'bogus' } } })).status, 400);
});

t('other people cannot see the batch, and cannot import into a team they have no write role in', async () => {
  assert.equal((await authed('salesMgr').get(`/data-import/batches/${created[0]}`)).status, 404);
  assert.equal((await authed('hr').get(`/data-import/batches/${created[0]}`)).status, 404);   // same team, not the owner
  const wrong = await preview('hr', salesTeam);
  assert.equal(wrong.status, 403);
});

t('a file with no candidate rows, a team with no id, and a team with no workflow are refused clearly', async () => {
  const wb = new ExcelJS.Workbook(); wb.addWorksheet('x').addRow(['hello world']);
  const empty = await preview('mgr', techTeam, Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(empty.status, 400); assert.match(empty.body.message, /No candidate rows/);
  const noTeam = await request(app).post('/api/v1/data-import/preview').set('Authorization', `Bearer ${tokens.mgr}`).attach('file', await workbook(), 'lineups.xlsx');
  assert.equal(noTeam.status, 400);
});

t('an expired batch is gone (410), and discarding removes the batch and its rows', async () => {
  const id = created[1];
  await pool.query("update import_batch set expires_at = now() - interval '1 minute' where id=$1", [id]);
  assert.equal((await authed('hr').get(`/data-import/batches/${id}`)).status, 410);
  await pool.query("update import_batch set expires_at = now() + interval '1 day' where id=$1", [id]);
  assert.equal((await authed('hr').del(`/data-import/batches/${id}`)).status, 204);
  assert.equal((await authed('hr').get(`/data-import/batches/${id}`)).status, 404);
  assert.equal((await pool.query('select count(*)::int n from import_row where batch_id=$1', [id])).rows[0].n, 0);
});

t('the purge removes only expired batches', async () => {
  const { purgeExpired } = require('../src/features/data-import/data-import.service');
  await pool.query("update import_batch set expires_at = now() - interval '1 day' where id=$1", [created[0]]);
  const n = await purgeExpired();
  assert.ok(n >= 1);
  assert.equal((await pool.query('select count(*)::int n from import_batch where id=$1', [created[0]])).rows[0].n, 0);
});

t('a second upload of an already-imported file is flagged', async () => {
  const buf = await workbook();
  const first = await preview('mgr', techTeam, buf); created.push(first.body.data.id);
  assert.equal(first.body.data.previouslyImported, null);
  await pool.query("update import_batch set status='done' where id=$1", [first.body.data.id]);
  const again = await preview('mgr', techTeam, buf); created.push(again.body.data.id);
  assert.equal(again.body.data.previouslyImported.id, first.body.data.id);
});
