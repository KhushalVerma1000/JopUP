/**
 * Committing and undoing an import against a real, seeded database. Opt-in:
 *
 *   npm run db:seed && npm run db:seed:demo -- --reset
 *   JOPUP_LIVE_TESTS=1 node --test test/dataImport.commit.live.test.js
 */
process.env.DATA_IMPORT_CHUNK = '3';           // several chunks for a 7-row file
const test = require('node:test');
const assert = require('node:assert/strict');

const live = process.env.JOPUP_LIVE_TESTS === '1';
const t = (name, fn) => test(name, { skip: !live && 'set JOPUP_LIVE_TESTS=1 (needs seeded demo data)' }, fn);

let request, app, pool, ExcelJS;
const tokens = {}; let techTeam; let salesTeam; let mgrId;
const api = (who) => ({
  get: (u) => request(app).get(`/api/v1${u}`).set('Authorization', `Bearer ${tokens[who]}`),
  post: (u, b) => request(app).post(`/api/v1${u}`).set('Authorization', `Bearer ${tokens[who]}`).send(b || {}),
});
const PHONES = ['9811100001', '9811100002', '9811100003', '9811100004', '9812345678', '9811100005'];
const NORM = PHONES.map((p) => `+91${p}`);
const day = (n) => { const d = new Date(Date.now() + n * 86400000); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; };
const HEAD = ['Name', 'Phone', 'Client', 'Position', 'Job Location', 'Lineup Date', 'Status', 'DOJ'];
const ROWS = [
  ['Priya Verma', '98123 45678', 'Orbit Logistics', 'Frontend Developer', 'Pune', day(-10), 'Reached', null],       // existing candidate, existing position
  ['Karan Mehta', 9811100001, 'Orbit Logistics', 'Frontend Developer', 'Pune', day(2), 'Lined up', null],          // upcoming lineup
  ['Isha Nair', 9811100002, 'Brand New Client Co', 'Analyst', 'Delhi', day(-5), 'Selected', null],                 // new client, location, position
  ['Karan Mehta', 9811100001, 'Zenith Fintech', 'Senior Backend Engineer', 'Bengaluru', day(2), 'Lined up', null], // same person, second client
  ['Dev Rao', 9811100003, 'Brand New Client Co', 'Analyst', 'Delhi', day(-20), 'Joined', day(-3)],                 // placed
  ['Rohan Das', 9811100004, 'Orbit Logistics', 'Frontend Developer', 'Pune', day(-8), 'Not selected', null],       // rejected
  [null, null, 'Orbit Logistics', 'Frontend Developer', 'Pune', day(1), 'Lined up', null],                         // no name: blocked
];
const workbook = async () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Lineups');
  ws.addRow(HEAD); ROWS.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
};
const preview = async (who = 'mgr') => {
  const res = await request(app).post('/api/v1/data-import/preview').set('Authorization', `Bearer ${tokens[who]}`)
    .field('teamId', techTeam).field('defaultCountry', 'IN').attach('file', await workbook(), 'commit.xlsx');
  assert.equal(res.status, 201, JSON.stringify(res.body)); return res.body.data;
};
const runToEnd = async (who, id) => {
  let last; let calls = 0;
  do { last = await api(who).post(`/data-import/batches/${id}/commit/next`); assert.equal(last.status, 200, JSON.stringify(last.body)); calls += 1; }
  while (last.body.data.status === 'importing' && calls < 20);
  return { data: last.body.data, calls };
};
const snapshot = async () => (await pool.query(`select (select count(*) from candidate where phone_normalized = any($1))::int cands,
  (select count(*) from candidate_tracker where candidate_id in (select id from candidate where phone_normalized = any($1)))::int trackers,
  (select count(*) from client where company_name='Brand New Client Co')::int clients,
  (select count(*) from open_position where designation='Analyst')::int positions,
  (select count(*) from client_mail_log where subject like 'Already sent before import%')::int mails`, [NORM])).rows[0];
const cleanup = async () => {
  await pool.query('delete from candidate_tracker where candidate_id in (select id from candidate where phone_normalized = any($1))', [NORM]);
  await pool.query('delete from candidate where phone_normalized = any($1)', [NORM]);
  await pool.query("delete from open_position where client_id in (select id from client where company_name='Brand New Client Co')");
  await pool.query("delete from client where company_name='Brand New Client Co'");
  await pool.query("delete from client_mail_log where subject like 'Already sent before import%'");
  await pool.query("delete from import_batch where file_name='commit.xlsx'");
};

test.before(async () => {
  if (!live) return;
  request = require('supertest'); app = require('../src/app'); pool = require('../src/utils/db').pool; ExcelJS = require('exceljs');
  for (const [k, email] of Object.entries({ mgr: 'manager.tech@acme.test', hr: 'hr.tech@acme.test', salesMgr: 'manager.sales@acme.test' })) {
    tokens[k] = (await request(app).post('/api/v1/auth/login').send({ email, password: 'Password123!' })).body.data.token;
  }
  techTeam = (await pool.query("select id from team where name='Tech Hiring'")).rows[0].id;
  salesTeam = (await pool.query("select id from team where name='Sales Hiring'")).rows[0].id;
  mgrId = (await pool.query("select id from \"user\" where email='manager.tech@acme.test'")).rows[0].id;
  await cleanup();
  const r = await api('mgr').post('/candidates', { ownerTeamId: techTeam, source: 'manual', phoneCountry: 'IN', firstName: 'Priya', lastName: 'Verma', phone: '9812345678' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
});
test.after(async () => { if (pool) { await cleanup(); await pool.end(); } });

let batchId; let before; let events;

t('commit needs an explicit go-ahead for blocked rows, then runs in chunks and can be resumed', async () => {
  before = await snapshot();
  events = (await pool.query("select count(*)::int n from event_log where event_type like 'candidate.%' or event_type like 'tracker.%'")).rows[0].n;
  const p = await preview(); batchId = p.id;
  assert.equal(p.summary.rows.blocked, 1);
  const refused = await api('mgr').post(`/data-import/batches/${batchId}/commit`, {});
  assert.equal(refused.status, 409); assert.equal(refused.body.data.code, 'BLOCKED_ROWS'); assert.equal(refused.body.data.blocked, 1);
  assert.deepEqual(await snapshot(), before);                                   // refusing wrote nothing

  const start = await api('mgr').post(`/data-import/batches/${batchId}/commit`, { skipBlocked: true, options: { alreadyMailed: true } });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  assert.equal(start.body.data.status, 'importing');
  assert.equal((await api('mgr').post(`/data-import/batches/${batchId}/commit`, { skipBlocked: true })).status, 409);   // not twice

  const first = await api('mgr').post(`/data-import/batches/${batchId}/commit/next`);
  assert.equal(first.body.data.status, 'importing');                             // 3 of 7 rows: not finished
  assert.equal(first.body.data.progress.processed, 3);
  assert.equal((await api('mgr').get(`/data-import/batches/${batchId}`)).body.data.progress.pending, 4);   // resumable from a fresh request
  const { data, calls } = await runToEnd('mgr', batchId);
  assert.equal(calls, 2); assert.equal(data.status, 'done');
  assert.equal(data.progress.pending, 0); assert.equal(data.progress.failed, 0); assert.equal(data.progress.skipped, 1);
  assert.equal((await api('mgr').post(`/data-import/batches/${batchId}/commit/next`)).status, 409);
});

t('what was created: candidates, one client with its location and position, six trackers', async () => {
  const r = (await api('mgr').get(`/data-import/batches/${batchId}`)).body.data.result;
  assert.equal(r.candidatesCreated, 4); assert.equal(r.candidatesReused, 1);       // Priya already existed
  assert.equal(r.trackersCreated, 6);
  assert.equal(r.clientsCreated, 1); assert.equal(r.positionsCreated, 1);
  assert.equal(r.locationsCreated, 3);                                              // Pune (Orbit), Bengaluru (Zenith), Delhi (new client): the demo has none yet
  const s = await snapshot();
  assert.equal(s.cands, 5);                                                         // nobody duplicated
  assert.equal(s.trackers, 6);
  const c = (await pool.query("select source, source_ref, owner_team_id, location from candidate where phone_normalized='+919811100001'")).rows[0];
  assert.equal(c.source, 'import'); assert.equal(c.source_ref, `import:${batchId}`); assert.equal(c.owner_team_id, techTeam);
  assert.equal(c.location, 'Pune');                                                 // sheet had no candidate location: job location used for mail routing
  assert.equal((await pool.query("select count(*)::int n from candidate_tracker where candidate_id = (select id from candidate where phone_normalized='+919811100001')")).rows[0].n, 2);
  const pos = (await pool.query("select vacancies, status, team_id from open_position where designation='Analyst'")).rows[0];
  assert.deepEqual([pos.vacancies, pos.status, pos.team_id], [1, 'open', techTeam]);
});

t('statuses and history: placed, rejected and in-progress trackers carry the right stage logs and dates', async () => {
  const q = async (phone) => (await pool.query(`select ct.id, ct.status, ct.assigned_hr, ct.created_at, ct.updated_at from candidate_tracker ct join candidate c on c.id=ct.candidate_id where c.phone_normalized=$1 order by ct.created_at`, [phone])).rows;
  const logs = async (id) => (await pool.query(`select s.stage_key, l.status, l.block_reason, l.entered_at, l.exited_at, l.moved_by, l.stage_data from candidate_tracker_stage_log l join workflow_stage s on s.id=l.stage_id where l.tracker_id=$1 order by s.order_index`, [id])).rows;

  const [dev] = await q('+919811100003');
  assert.equal(dev.status, 'placed');
  const dl = await logs(dev.id);
  assert.equal(dl[dl.length - 1].stage_key, 'joined'); assert.equal(dl[dl.length - 1].status, 'active'); assert.equal(dl[dl.length - 1].exited_at, null);
  assert.ok(dl.slice(0, -1).every((l) => l.status === 'advanced' && l.exited_at));
  assert.equal(dl[0].stage_data.imported, true);
  const days = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000);
  assert.ok(Math.abs(days(Date.now(), dev.created_at) - 20) <= 1);                  // history starts at the lineup date, 20 days ago
  assert.ok(Math.abs(days(Date.now(), dl[dl.length - 1].entered_at) - 3) <= 1);     // joined on the DOJ

  const [rohan] = await q('+919811100004');
  assert.equal(rohan.status, 'rejected');
  const rl = (await logs(rohan.id)).pop();
  assert.equal(rl.status, 'blocked'); assert.equal(rl.block_reason, 'Not selected'); assert.ok(rl.exited_at);

  const [priya] = await q('+919812345678');
  assert.equal(priya.status, 'active'); assert.equal(priya.assigned_hr, mgrId);     // no recruiter column: whoever imported
  assert.equal((await logs(priya.id)).pop().stage_key, 'lineup');                  // "Reached" is Turn up, which this team's pipeline does not have: nearest earlier stage

  const isha = (await q('+919811100002'))[0];
  assert.equal((await logs(isha.id)).pop().stage_key, 'offer');
});

t('the import is silent: no events, no automation, and upcoming lineups are marked as already mailed', async () => {
  const now = (await pool.query("select count(*)::int n from event_log where event_type like 'candidate.%' or event_type like 'tracker.%'")).rows[0].n;
  assert.equal(now, events);
  const logs = (await pool.query("select mail_type, candidate_count, to_emails from client_mail_log where subject like 'Already sent before import%' order by mail_type")).rows;
  assert.ok(logs.length >= 1 && logs.every((l) => l.mail_type === 'lineup'));       // only today-or-later lineups; none for the past
  assert.equal(logs.reduce((a, l) => a + l.candidate_count, 0), 2);                 // Karan's two upcoming lineups
  const pending = (await api('mgr').get('/mail/pending')).body.data || [];
  const karan = pending.filter((g) => g.type === 'lineup' && ['Orbit Logistics', 'Zenith Fintech'].includes(g.clientName) && g.date === new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));
  assert.ok(karan.length >= 1 && karan.every((g) => g.unsent === 0), JSON.stringify(karan));
});

t('undo removes everything the import made and nothing else', async () => {
  const res = await api('mgr').post(`/data-import/batches/${batchId}/undo`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.status, 'undone');
  const { removed, kept } = res.body.data.undo;
  assert.equal(removed.trackers, 6); assert.equal(removed.candidates, 4);
  assert.equal(removed.clients, 1); assert.equal(removed.positions, 1); assert.equal(removed.locations, 3);
  assert.deepEqual(Object.values(kept).reduce((a, b) => a + b, 0), 0);
  const after = await snapshot();
  assert.deepEqual(after, { ...before, cands: 1 });                                  // only the pre-existing Priya remains
  assert.equal((await pool.query("select count(*)::int n from candidate where phone_normalized='+919812345678'")).rows[0].n, 1);
  assert.equal((await api('mgr').post(`/data-import/batches/${batchId}/undo`)).status, 409);   // not twice
});

t('without "already mailed", upcoming lineups show up as still to send', async () => {
  const p = await preview();
  await api('mgr').post(`/data-import/batches/${p.id}/commit`, { skipBlocked: true });
  await runToEnd('mgr', p.id);
  assert.equal((await snapshot()).mails, 0);
  const pending = (await api('mgr').get('/mail/pending')).body.data || [];
  const iso = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  assert.ok(pending.some((g) => g.type === 'lineup' && g.date === iso && g.unsent > 0));
  assert.equal((await api('mgr').post(`/data-import/batches/${p.id}/undo`)).status, 200);
});

t('undo keeps anything HR worked on afterwards, and says so', async () => {
  const p = await preview();
  await api('mgr').post(`/data-import/batches/${p.id}/commit`, { skipBlocked: true });
  await runToEnd('mgr', p.id);
  // HR moves Karan's Orbit lineup on to the next stage
  const tr = (await pool.query(`select ct.id, ct.workflow_template_id from candidate_tracker ct join candidate c on c.id=ct.candidate_id where c.phone_normalized='+919811100001' order by ct.created_at limit 1`)).rows[0];
  const next = (await pool.query(`select s.id from workflow_stage s where s.workflow_template_id=$1 and s.order_index > (select s2.order_index from candidate_tracker_stage_log l join workflow_stage s2 on s2.id=l.stage_id where l.tracker_id=$2 and l.exited_at is null) order by s.order_index limit 1`, [tr.workflow_template_id, tr.id])).rows[0];
  const adv = await api('mgr').post(`/trackers/${tr.id}/advance`, { nextStageId: next.id });
  assert.ok([200, 201].includes(adv.status), JSON.stringify(adv.body));
  const res = await api('mgr').post(`/data-import/batches/${p.id}/undo`);
  assert.equal(res.status, 200);
  const { removed, kept } = res.body.data.undo;
  assert.equal(kept.trackers, 1); assert.equal(removed.trackers, 5);
  assert.equal(kept.candidates, 1);                                                   // Karan still has a live tracker
  assert.equal((await pool.query('select count(*)::int n from candidate_tracker where id=$1', [tr.id])).rows[0].n, 1);
  assert.equal((await pool.query("select count(*)::int n from candidate where phone_normalized='+919811100001'")).rows[0].n, 1);
  await pool.query('delete from candidate_tracker where id=$1', [tr.id]);
  await pool.query("delete from candidate where phone_normalized='+919811100001'");
});

t('a row that fails at write time is recorded, the rest still import', async () => {
  const p = await preview();
  // after the preview someone in another team adds Isha: she now exists where this importer cannot see
  const mk = await api('salesMgr').post('/candidates', { ownerTeamId: salesTeam, source: 'manual', phoneCountry: 'IN', firstName: 'Isha', lastName: 'Nair', phone: '9811100002' });
  assert.equal(mk.status, 201, JSON.stringify(mk.body));
  await api('mgr').post(`/data-import/batches/${p.id}/commit`, { skipBlocked: true });
  const { data } = await runToEnd('mgr', p.id);
  assert.equal(data.status, 'done'); assert.equal(data.progress.failed, 1);
  const failed = (await api('mgr').get(`/data-import/batches/${p.id}/rows?filter=all&limit=50`)).body.data.rows.find((r) => r.status === 'failed');
  assert.equal(failed.data.candidate.firstName, 'Isha');
  assert.equal(data.result.trackersCreated, 5);
  await pool.query("delete from candidate where phone_normalized='+919811100002' and owner_team_id=$1", [salesTeam]);
  assert.equal((await api('mgr').post(`/data-import/batches/${p.id}/undo`)).status, 200);
});

t('access: a teammate cannot run or undo someone else\'s import, and an unstarted batch cannot be undone', async () => {
  const p = await preview();
  assert.equal((await api('hr').post(`/data-import/batches/${p.id}/commit`, { skipBlocked: true })).status, 404);
  assert.equal((await api('hr').post(`/data-import/batches/${p.id}/commit/next`)).status, 404);
  assert.equal((await api('mgr').post(`/data-import/batches/${p.id}/undo`)).status, 409);
  assert.equal((await api('mgr').post(`/data-import/batches/${p.id}/commit/next`)).status, 409);   // must be started first
  assert.equal((await api('salesMgr').post(`/data-import/batches/${p.id}/undo`)).status, 404);
});

t('HR who cannot create clients can import rows for clients that exist, once the rest is left out', async () => {
  const p = await preview('hr');
  assert.ok(p.summary.rows.blocked >= 1);
  const refused = await api('hr').post(`/data-import/batches/${p.id}/commit`, {});
  assert.equal(refused.status, 409);
  const ok = await api('hr').post(`/data-import/batches/${p.id}/commit`, { skipBlocked: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const { data } = await runToEnd('hr', p.id);
  assert.equal(data.status, 'done');
  assert.equal(data.result.clientsCreated, 0);                                        // never created what HR may not create
  assert.equal((await snapshot()).clients, 0);
  assert.equal((await api('hr').post(`/data-import/batches/${p.id}/undo`)).status, 200);
});

t('plan limits: an import that does not fit is refused whole, with the headroom, and writes nothing', async () => {
  const ent = require('../src/utils/entitlements');
  const orgId = (await pool.query("select organisation_id id from \"user\" where email='manager.tech@acme.test'")).rows[0].id;
  const planId = (await pool.query('select plan_id id from organisation where id=$1', [orgId])).rows[0].id;
  const orig = (await pool.query('select limits->>\'max_candidates\' v from plan where id=$1', [planId])).rows[0].v;
  const have = (await pool.query('select count(*)::int n from candidate where organisation_id=$1', [orgId])).rows[0].n;
  try {
    await pool.query("update plan set limits = jsonb_set(limits, '{max_candidates}', to_jsonb($2::int)) where id=$1", [planId, have + 2]);
    await ent.loadOrgContext(orgId, { fresh: true });
    const p = await preview();
    assert.equal(p.limits.max_candidates.ok, false); assert.equal(p.limits.max_candidates.remaining, 2); assert.equal(p.limits.max_candidates.adding, 4);
    const before2 = await snapshot();
    const res = await api('mgr').post(`/data-import/batches/${p.id}/commit`, { skipBlocked: true });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.data.code, 'PLAN_LIMIT'); assert.equal(res.body.data.remaining, 2); assert.equal(res.body.data.requested, 4);
    assert.deepEqual(await snapshot(), before2);
    assert.equal((await api('mgr').get(`/data-import/batches/${p.id}`)).body.data.status, 'previewed');   // still reviewable: trim and retry
  } finally {
    await pool.query("update plan set limits = jsonb_set(limits, '{max_candidates}', to_jsonb($2::int)) where id=$1", [planId, Number(orig)]);
    await ent.loadOrgContext(orgId, { fresh: true });
  }
});
