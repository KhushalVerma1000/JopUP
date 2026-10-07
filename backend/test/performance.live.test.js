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
  del: (u) => request(app).delete(`/api/v1${u}`).set('Authorization', `Bearer ${tokens[who]}`),
});
const manualKpi = async (who = 'mgr') => (await api(who).get('/performance/kpis')).body.data.kpis.find((x) => x.source === 'manual');
const autoKpi = async (name, who = 'mgr') => (await api(who).get('/performance/kpis')).body.data.kpis.find((x) => x.source === 'auto' && x.name === name);

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
  const k = r.body.data.kpis.find((x) => x.name === 'Client satisfaction');
  assert.ok(k.recent.length > 1 && k.latest && k.health.label && k.teamName);
});

t('another team cannot read or write a KPI (404, not 403)', async () => {
  const kpi = await manualKpi();
  assert.equal((await api('salesMgr').get(`/performance/kpis/${kpi.id}/entries`)).status, 404);
  assert.equal((await api('salesMgr').post('/performance/kpi-entries', { kpiId: kpi.id, value: 1 })).status, 404);
});

t('HR can read KPIs but not record them; recording the same period corrects it', async () => {
  const kpi = await manualKpi();
  assert.equal((await api('hr').post('/performance/kpi-entries', { kpiId: kpi.id, value: 1 })).status, 403);
  await pool.query("delete from kpi_entry where kpi_id = $1 and period_date = '2031-01-01'", [kpi.id]); // re-runnable without a re-seed
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
  const mine = goals.find((g) => g.assignedToName && !g.isAuto && g.effectiveStatus === 'active' && g.progressPct < 100);
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

// ── Automatic KPIs, goals and strategy ────────────────────────────────────────
const TECH = async () => (await api('mgr').get('/performance/kpis')).body.data.kpis[0].teamId;

t('metric catalogue is served to any signed-in user', async () => {
  const r = await api('hr').get('/performance/metrics');
  assert.equal(r.status, 200);
  const keys = r.body.data.metrics.map((m) => m.key);
  for (const k of ['placements', 'win_rate', 'avg_days_to_place', 'fill_rate']) assert.ok(keys.includes(k), k);
});

t('auto KPI: the stored value matches an independent count of placements for that month', async () => {
  const k = await autoKpi('Placements per month');
  assert.equal(k.isAuto, true);
  assert.ok(k.latest, 'an automatic KPI has readings with nobody typing them in');
  const team = k.teamId;
  for (const pt of k.recent) {
    const { rows } = await pool.query(`
      select count(*)::int as n from (
        select ct.id, min(l.entered_at) as placed_at from candidate_tracker ct
        join candidate_tracker_stage_log l on l.tracker_id = ct.id
        join workflow_stage s on s.id = l.stage_id and s.is_final_success
        where ct.team_id = $1 and ct.status = 'placed' group by ct.id) p
      where (p.placed_at at time zone (select coalesce(timezone,'UTC') from organisation where id = (select organisation_id from team where id = $1)))::date >= $2::date
        and (p.placed_at at time zone (select coalesce(timezone,'UTC') from organisation where id = (select organisation_id from team where id = $1)))::date < ($2::date + interval '1 month')`, [team, pt.periodDate]);
    assert.equal(pt.value, rows[0].n, `period ${pt.periodDate}`);
  }
});

t('auto KPI: a closed period is locked, and a forced sync does not touch it', async () => {
  const k = await autoKpi('Placements per month');
  const locked = k.recent.find((p) => p.locked);
  assert.ok(locked, 'an earlier period is locked');
  await pool.query('update kpi_entry set value = 999 where kpi_id = $1 and period_date = $2', [k.id, locked.periodDate]);
  assert.equal((await api('mgr').post('/performance/sync')).status, 200);
  const again = (await autoKpi('Placements per month')).recent.find((p) => p.periodDate === locked.periodDate);
  assert.equal(again.value, 999, 'locked reading was left alone');
  await pool.query('update kpi_entry set value = $3 where kpi_id = $1 and period_date = $2', [k.id, locked.periodDate, locked.value]);
});

t('auto KPI: overriding needs a reason, keeps the computed value, and can be reverted', async () => {
  const k = await autoKpi('Placements per month');
  const open = k.recent[k.recent.length - 1];
  const body = { kpiId: k.id, value: 42, periodDate: open.periodDate };
  assert.equal((await api('mgr').post('/performance/kpi-entries', body)).status, 400);
  assert.equal((await api('hr').post('/performance/kpi-entries', { ...body, notes: 'x' })).status, 403);
  const r = await api('mgr').post('/performance/kpi-entries', { ...body, notes: 'Two placements were booked off-system' });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.entry.source, 'override');
  assert.equal(r.body.data.entry.value, 42);
  assert.equal(r.body.data.entry.computedValue, open.value);
  // a sync must not undo a person's override
  await api('mgr').post(`/performance/kpis/${k.id}/recompute`);
  assert.equal((await autoKpi('Placements per month')).latest.value, 42);
  const rev = await api('mgr').del(`/performance/kpi-entries/${r.body.data.entry.id}/override`);
  assert.equal(rev.status, 200);
  assert.equal(rev.body.data.entry.source, 'auto');
  assert.equal(rev.body.data.entry.value, open.value);
});

t('auto KPI: a manager picks only a metric and target; name, unit, direction and history fill in', async () => {
  const teamId = await TECH();
  const r = await api('mgr').post('/performance/kpis', { teamId, metricKey: 'win_rate', targetValue: 40 });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.kpi.name, 'Win rate');
  assert.equal(r.body.data.kpi.unit, '%');
  assert.equal(r.body.data.kpi.source, 'auto');
  assert.equal((await api('mgr').post('/performance/kpis', { teamId, metricKey: 'nope' })).status, 400);
  assert.equal((await api('mgr').post('/performance/kpis', { teamId, source: 'manual', metricKey: 'win_rate' })).status, 400);
  assert.equal((await api('mgr').patch(`/performance/kpis/${r.body.data.kpi.id}`, { frequency: 'weekly' })).status, 409);
  await pool.query('delete from kpi_definition where id = $1', [r.body.data.kpi.id]);
});

t('metric goal: progress is computed, the assignee cannot overwrite it, and it needs a window', async () => {
  const teamId = await TECH();
  assert.equal((await api('mgr').post('/performance/goals', { teamId, title: 'x', metricKey: 'placements', targetValue: 5 })).status, 400);
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
  const r = await api('mgr').post('/performance/goals', { teamId, title: 'Place 50 this quarter', metricKey: 'placements', targetValue: 50, startDate: '2026-01-01', dueDate: due });
  assert.equal(r.status, 201);
  const g = r.body.data.goal;
  assert.equal(g.isAuto, true);
  assert.equal(g.status, 'active');
  assert.ok(g.progressPct >= 0 && g.progressPct < 100 && typeof g.currentValue === 'number');
  assert.equal((await api('mgr').patch(`/performance/goals/${g.id}`, { progressPct: 90 })).status, 400);
  const mine = (await api('hr').get('/performance/goals')).body.data.goals.find((x) => x.isAuto && x.assignedToName);
  assert.equal((await api('hr').patch(`/performance/goals/${mine.id}/progress`, { progressPct: 10 })).status, 409);
  // an easy target completes by itself, and freezes
  const easy = (await api('mgr').post('/performance/goals', { teamId, title: 'Add some candidates', metricKey: 'candidates_added', targetValue: 1, startDate: '2026-01-01', dueDate: due })).body.data.goal;
  assert.equal(easy.status, 'completed');
  assert.equal(easy.progressPct, 100);
  await pool.query('delete from goal where id = any($1)', [[g.id, easy.id]]);
});

t('metric goal: a team-only metric cannot be assigned to one person', async () => {
  const teamId = await TECH();
  const hr = (await api('mgr').get('/performance/goals')).body.data.goals.find((x) => x.assignedTo).assignedTo;
  const due = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  assert.equal((await api('mgr').post('/performance/goals', { teamId, title: 'x', metricKey: 'fill_rate', targetValue: 80, dueDate: due, assignedTo: hr })).status, 400);
});

t('strategy: metric key results are measured live; manual ones keep their typed number', async () => {
  const r = await api('mgr').get('/performance/strategies');
  assert.equal(r.status, 200);
  const s = r.body.data.strategies[0];
  const krs = s.objectives.flatMap((o) => o.key_results);
  const metric = krs.find((k) => k.type === 'metric' && k.metric_key === 'placements');
  assert.equal(typeof metric.current, 'number');
  assert.ok(['on_track', 'at_risk', 'off_track', 'just_started', 'not_started', 'achieved', 'missed'].includes(metric.status));
  const manual = krs.find((k) => k.type === 'manual');
  assert.equal(manual.current, 80);
  assert.equal(manual.source, 'manual');
  assert.ok(s.objectives.every((o) => o.progressPct === null || (o.progressPct >= 0 && o.progressPct <= 100)));
  assert.ok(s.progressPct >= 0 && s.progressPct <= 100);
});

t('strategy: an unreadable period needs dates; links must stay inside the team; a finished one is locked', async () => {
  const teamId = await TECH();
  const kr = { kr: 'Place 5', target: 5, type: 'metric', metric_key: 'placements' };
  const base = { teamId, title: 'Test', objectives: [{ objective: 'o', key_results: [kr] }] };
  assert.equal((await api('mgr').post('/performance/strategies', { ...base, period: 'FY2026' })).status, 400);
  const salesKpi = (await api('salesMgr').get('/performance/kpis')).body.data.kpis[0].id;
  const bad = { ...base, period: 'Q4 2026', objectives: [{ objective: 'o', key_results: [{ kr: 'k', target: 1, type: 'kpi', kpi_id: salesKpi }] }] };
  assert.equal((await api('mgr').post('/performance/strategies', bad)).status, 400);
  const ok = await api('mgr').post('/performance/strategies', { ...base, period: 'FY2026', startDate: '2025-01-01', endDate: '2025-03-31' });
  assert.equal(ok.status, 201);
  const id = ok.body.data.strategy.id;
  assert.equal(ok.body.data.strategy.window.start, '2025-01-01');
  // the hourly job freezes a finished strategy; after that the measurement can't be edited
  await api('mgr').post('/performance/sync');
  const frozen = (await api('mgr').get('/performance/strategies')).body.data.strategies.find((x) => x.id === id);
  assert.equal(frozen.isFinal, true);
  assert.equal((await api('mgr').patch(`/performance/strategies/${id}`, { period: 'Q4 2026' })).status, 409);
  assert.equal((await api('mgr').patch(`/performance/strategies/${id}`, { retrospective: 'We missed.' })).status, 200);
  await pool.query('delete from team_strategy where id = $1', [id]);
});

t('sync is manager-only', async () => {
  assert.equal((await api('hr').post('/performance/sync')).status, 403);
  assert.equal((await api('mgr').post('/performance/sync')).status, 200);
});
