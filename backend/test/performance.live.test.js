/**
 * Integration checks against a real, seeded database. Opt-in, because they
 * need Postgres plus the demo data:
 *
 *   npm run db:seed && npm run db:seed:demo -- --reset
 *   JOPUP_LIVE_TESTS=1 node --test test/performance.live.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const live = process.env.JOPUP_LIVE_TESTS === '1';
const t = (name, fn) => test(name, { skip: !live && 'set JOPUP_LIVE_TESTS=1 (needs seeded demo data)' }, fn);

let request, app, pool;
const tokens = {};
const api = (who) => ({
  get: (u) => request(app).get(`/api/v1${u}`).set('Authorization', `Bearer ${tokens[who]}`),
  post: (u, b = {}) => request(app).post(`/api/v1${u}`).set('Authorization', `Bearer ${tokens[who]}`).send(b),
  patch: (u, b = {}) => request(app).patch(`/api/v1${u}`).set('Authorization', `Bearer ${tokens[who]}`).send(b),
});

test.before(async () => {
  if (!live) return;
  request = require('supertest'); app = require('../src/app'); pool = require('../src/utils/db').pool;
  const people = { mgr: 'manager.tech@acme.test', hr: 'hr.tech@acme.test', hr2: 'hr.tech2@acme.test', salesMgr: 'manager.sales@acme.test', admin: 'admin@acme.test', starter: 'manager@northwind.test' };
  for (const [k, email] of Object.entries(people)) {
    tokens[k] = (await request(app).post('/api/v1/auth/login').send({ email, password: 'Password123!' })).body.data.token;
  }
});
test.after(async () => { if (pool) await pool.end(); });

t('KPI board arrives in one call with latest value, trend and server-computed health', async () => {
  const r = await api('mgr').get('/performance/kpis');
  assert.equal(r.status, 200);
  const k = r.body.data.kpis.find((x) => x.name === 'Avg. days to place');
  assert.ok(k.recent.length > 1 && k.latest && k.health.label && k.teamName);
});

t('another team cannot read or write a KPI (404, not 403)', async () => {
  const kpi = (await api('mgr').get('/performance/kpis')).body.data.kpis[0];
  assert.equal((await api('salesMgr').get(`/performance/kpis/${kpi.id}/entries`)).status, 404);
  assert.equal((await api('salesMgr').post('/performance/kpi-entries', { kpiId: kpi.id, value: 1 })).status, 404);
});

t('HR can read KPIs but not record them; recording the same period corrects it', async () => {
  const kpi = (await api('mgr').get('/performance/kpis')).body.data.kpis[0];
  assert.equal((await api('hr').post('/performance/kpi-entries', { kpiId: kpi.id, value: 1 })).status, 403);
  const a = await api('mgr').post('/performance/kpi-entries', { kpiId: kpi.id, value: 11, periodDate: '2031-01-01' });
  const b = await api('mgr').post('/performance/kpi-entries', { kpiId: kpi.id, value: 12, periodDate: '2031-01-01' });
  assert.equal(a.body.data.replaced, false);
  assert.equal(b.body.data.replaced, true);
  assert.equal(b.body.data.entry.value, 12);
});

t('plans without the module get a clear 403', async () => {
  const r = await api('starter').get('/performance/kpis');
  assert.equal(r.status, 403);
  assert.match(r.body.message, /kpi_engine/);
});

t('reviews: a teammate sees only their own submitted review and never the private notes', async () => {
  const hrView = (await api('hr').get('/performance/reviews')).body.data.reviews;
  assert.ok(hrView.every((r) => r.isMine && r.status !== 'draft' && !('managerNotes' in r)));
  assert.equal((await api('hr2').get('/performance/reviews')).body.data.reviews.length, 0);
  const mgrView = (await api('mgr').get('/performance/reviews')).body.data.reviews;
  assert.ok(mgrView.some((r) => r.status === 'draft' && 'managerNotes' in r));
});

t('only the reviewee can acknowledge; submitted reviews are frozen', async () => {
  const review = (await api('mgr').get('/performance/reviews')).body.data.reviews.find((r) => r.status === 'submitted' || r.status === 'acknowledged');
  assert.equal((await api('hr2').post(`/performance/reviews/${review.id}/acknowledge`)).status, 404);
  assert.equal((await api('hr').post(`/performance/reviews/${review.id}/acknowledge`)).status, 200);
  assert.equal((await api('mgr').patch(`/performance/reviews/${review.id}`, { summary: 'changed' })).status, 409);
});

t('goals: overdue is derived; the assignee can report progress, others cannot', async () => {
  const goals = (await api('hr').get('/performance/goals')).body.data.goals;
  assert.ok(goals.some((g) => g.isOverdue));
  const mine = goals.find((g) => g.assignedToName && g.effectiveStatus === 'active' && g.progressPct < 100);
  assert.equal((await api('hr').patch(`/performance/goals/${mine.id}/progress`, { progressPct: 55 })).status, 200);
  assert.equal((await api('hr2').patch(`/performance/goals/${mine.id}/progress`, { progressPct: 56 })).status, 404);
  assert.equal((await api('hr').patch(`/performance/goals/${mine.id}`, { title: 'hijack' })).status, 403);
});

t('analytics: real cohort funnel, win rate and recruiter load', async () => {
  const r = await api('hr').get('/analytics/pipeline?days=all');
  assert.equal(r.status, 200);
  const d = r.body.data;
  assert.ok(d.summary.total >= d.summary.placed + d.summary.rejected);
  assert.equal(d.funnel[0].stageKey, 'applied');
  assert.ok(d.funnel.every((s, i) => i === 0 || s.reached <= d.funnel[i - 1].reached || s.isFinal === false));
  assert.ok(d.recruiters.length > 0 && d.positions.vacancies >= d.positions.filled);
});

t('analytics: HR cannot ask about a team they are not in; org_admin sees everything', async () => {
  const salesTeam = (await api('salesMgr').get('/performance/kpis')).body.data.kpis[0].teamId;
  assert.equal((await api('hr').get(`/analytics/pipeline?teamId=${salesTeam}`)).status, 403);
  const all = (await api('admin').get('/analytics/pipeline?days=all')).body.data.summary.total;
  const mine = (await api('hr').get('/analytics/pipeline?days=all')).body.data.summary.total;
  assert.ok(all > mine);
});
