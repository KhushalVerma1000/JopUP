const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const math = require('../src/features/performance/performance.math');
const schema = require('../src/features/performance/performance.schema');
const analyticsSchema = require('../src/features/analytics/analytics.schema');
const { teamsWithPermission, canActOnTeam } = require('../src/utils/teamScope');

const U = '11111111-1111-4111-8111-111111111111';
const T1 = '22222222-2222-4222-8222-222222222222';
const T2 = '33333333-3333-4333-8333-333333333333';

// ── KPI health ────────────────────────────────────────────────────────────
test('kpiHealth: higher_better bands at target, 80% and below', () => {
  assert.equal(math.kpiHealth(10, 10).tone, 'good');
  assert.equal(math.kpiHealth(8, 10).tone, 'warn');
  assert.equal(math.kpiHealth(7.9, 10).tone, 'bad');
});
test('kpiHealth: lower_better is the mirror image (over target is bad)', () => {
  assert.equal(math.kpiHealth(25, 25, 'lower_better').tone, 'good');
  assert.equal(math.kpiHealth(30, 25, 'lower_better').tone, 'warn');
  assert.equal(math.kpiHealth(31, 25, 'lower_better').tone, 'bad');
});
test('kpiHealth: target_exact allows ±5% good, ±15% close', () => {
  assert.equal(math.kpiHealth(102, 100, 'target_exact').tone, 'good');
  assert.equal(math.kpiHealth(112, 100, 'target_exact').tone, 'warn');
  assert.equal(math.kpiHealth(130, 100, 'target_exact').tone, 'bad');
});
test('kpiHealth: no reading or no target is neutral, never red', () => {
  assert.equal(math.kpiHealth(null, 10).label, 'No data yet');
  assert.equal(math.kpiHealth(5, null).label, 'No target set');
  assert.equal(math.kpiHealth(5, 0).label, 'No target set');
});
test('changePct and isImprovement respect direction', () => {
  assert.equal(math.changePct(20, 25), 25);
  assert.equal(math.changePct(0, 5), null);
  assert.equal(math.isImprovement(-10, 'lower_better'), true);
  assert.equal(math.isImprovement(-10, 'higher_better'), false);
  assert.equal(math.isImprovement(5, 'target_exact'), null);
});

// ── dates and goals ───────────────────────────────────────────────────────
test('toDateOnly accepts plain dates and ISO datetimes, rejects impossible dates', () => {
  assert.equal(math.toDateOnly('2026-03-31'), '2026-03-31');
  assert.equal(math.toDateOnly('2026-03-31T10:00:00.000Z'), '2026-03-31');
  assert.equal(math.toDateOnly('2026-02-30'), null);
  assert.equal(math.toDateOnly('nope'), null);
});
test('a goal past its due date is overdue without anyone flipping a flag', () => {
  const now = new Date('2026-10-06T12:00:00Z');
  assert.equal(math.effectiveGoalStatus({ status: 'active', dueDate: '2026-10-05' }, now), 'overdue');
  assert.equal(math.effectiveGoalStatus({ status: 'active', dueDate: '2026-10-06' }, now), 'active');
  assert.equal(math.effectiveGoalStatus({ status: 'active', dueDate: null }, now), 'active');
  assert.equal(math.effectiveGoalStatus({ status: 'completed', dueDate: '2020-01-01' }, now), 'completed');
  assert.equal(math.daysUntil('2026-10-09', now), 3);
});
test('defaultPeriodLabel follows the KPI frequency', () => {
  assert.equal(math.defaultPeriodLabel('quarterly', '2026-08-01'), 'Q3 2026');
  assert.match(math.defaultPeriodLabel('monthly', '2026-03-01'), /March 2026/);
});
test('averageScore ignores blanks', () => {
  assert.equal(math.averageScore({ a: 4, b: 3 }), 3.5);
  assert.equal(math.averageScore({}), null);
});

// ── request validation ────────────────────────────────────────────────────
test('KPI entry takes a plain date and normalises it; teamId is optional', () => {
  const r = schema.createKpiEntrySchema.safeParse({ body: { kpiId: U, value: 3, periodDate: '2026-03-01T00:00:00.000Z' } });
  assert.equal(r.success, true);
  assert.equal(r.data.body.periodDate, '2026-03-01');
  assert.equal(schema.createKpiEntrySchema.safeParse({ body: { kpiId: U, value: 'x' } }).success, false);
});
test('a KPI cannot be moved to another team by an update', () => {
  assert.equal(schema.updateKpiSchema.safeParse({ body: { teamId: T1 }, params: { id: U } }).success, false);
  assert.equal(schema.updateKpiSchema.safeParse({ body: { isActive: false }, params: { id: U } }).success, true);
});
test('reviews: scores 1–5 only, and nobody can set "acknowledged" through the edit route', () => {
  assert.equal(schema.createReviewSchema.safeParse({ body: { teamId: T1, revieweeId: U, cycle: 'Q1', scores: { a: 6 } } }).success, false);
  assert.equal(schema.createReviewSchema.safeParse({ body: { teamId: T1, revieweeId: U, cycle: 'Q1', scores: { a: 5 } } }).success, true);
  assert.equal(schema.updateReviewSchema.safeParse({ body: { status: 'acknowledged' }, params: { id: U } }).success, false);
  assert.equal(schema.updateReviewSchema.safeParse({ body: { status: 'submitted' }, params: { id: U } }).success, true);
});
test('goals: due date can be cleared with null; impossible dates are rejected', () => {
  assert.equal(schema.updateGoalSchema.safeParse({ body: { dueDate: null }, params: { id: U } }).success, true);
  assert.equal(schema.createGoalSchema.safeParse({ body: { teamId: T1, title: 'x', dueDate: '2026-02-30' } }).success, false);
  assert.equal(schema.goalProgressSchema.safeParse({ body: { progressPct: 101 }, params: { id: U } }).success, false);
});
test('strategy objectives are validated, not free-form JSON', () => {
  const ok = { teamId: T1, title: 'Grow', period: 'Q4', objectives: [{ objective: 'Double', key_results: [{ kr: 'Place 40', target: 40 }] }] };
  assert.equal(schema.createStrategySchema.safeParse({ body: ok }).success, true);
  assert.equal(schema.createStrategySchema.safeParse({ body: { ...ok, objectives: [{ objective: 'x', key_results: [{ kr: 'y', target: 'lots' }] }] } }).success, false);
});
test('analytics query: days is a number or "all"', () => {
  assert.equal(analyticsSchema.pipelineQuerySchema.safeParse({ query: { days: '30' } }).data.query.days, 30);
  assert.equal(analyticsSchema.pipelineQuerySchema.safeParse({ query: { days: 'all' } }).success, true);
  assert.equal(analyticsSchema.pipelineQuerySchema.safeParse({ query: { days: '0' } }).success, false);
});

// ── per-permission team reach ─────────────────────────────────────────────
const perms = (entity, actions) => ({ [entity]: actions });
test('write reach follows the permission, not just team membership', () => {
  const user = { roles: [
    { roleName: 'manager', teamId: T1, permissions: perms('kpi', ['read', 'write']) },
    { roleName: 'hr', teamId: T2, permissions: perms('kpi', ['read']) },
  ] };
  assert.deepEqual(teamsWithPermission(user, 'kpi', 'write'), [T1]);
  assert.equal(canActOnTeam(user, T1, 'kpi', 'write'), true);
  assert.equal(canActOnTeam(user, T2, 'kpi', 'write'), false);
  assert.equal(canActOnTeam(user, T2, 'kpi', 'read'), true);
});
test('an org-wide role grants every team; no role grants none', () => {
  assert.equal(teamsWithPermission({ roles: [{ roleName: 'org_admin', teamId: null, permissions: perms('goals', ['write']) }] }, 'goals', 'write'), null);
  assert.deepEqual(teamsWithPermission({ roles: [] }, 'goals', 'write'), []);
  assert.equal(canActOnTeam(undefined, T1, 'goals', 'write'), false);
});

// ── routes demand a login ─────────────────────────────────────────────────
for (const [method, path] of [
  ['get', '/api/v1/performance/kpis'], ['post', '/api/v1/performance/kpi-entries'], ['get', '/api/v1/performance/overview'],
  ['get', '/api/v1/performance/reviews'], ['post', `/api/v1/performance/reviews/${U}/acknowledge`],
  ['get', '/api/v1/performance/goals'], ['patch', `/api/v1/performance/goals/${U}/progress`],
  ['get', '/api/v1/performance/strategies'], ['get', '/api/v1/analytics/pipeline'],
]) {
  test(`${method.toUpperCase()} ${path.replace(U, ':id')} requires authentication`, async () => {
    assert.equal((await request(app)[method](path).send({})).status, 401);
  });
}

// ── Automatic metrics: pure rules ─────────────────────────────────────────────
const catalogue = require('../src/features/performance/metrics.catalogue');

test('periodBounds: monthly, weekly (Monday start), quarterly, daily, year rollover', () => {
  assert.deepEqual(math.periodBounds('monthly', '2026-12-15'), { start: '2026-12-01', end: '2027-01-01' });
  assert.deepEqual(math.periodBounds('weekly', '2026-10-06'), { start: '2026-10-05', end: '2026-10-12' });
  assert.deepEqual(math.periodBounds('weekly', '2026-10-11'), { start: '2026-10-05', end: '2026-10-12' }); // Sunday
  assert.deepEqual(math.periodBounds('quarterly', '2026-11-30'), { start: '2026-10-01', end: '2027-01-01' });
  assert.deepEqual(math.periodBounds('daily', '2026-02-28'), { start: '2026-02-28', end: '2026-03-01' });
});
test('recentPeriods walks back oldest-first across year boundaries', () => {
  assert.deepEqual(math.recentPeriods('monthly', '2026-02-10', 3).map((p) => p.start), ['2025-12-01', '2026-01-01', '2026-02-01']);
});
test('parsePeriod reads quarters, halves, years and months; refuses FY (ambiguous)', () => {
  assert.deepEqual(math.parsePeriod('Q4 2026'), { start: '2026-10-01', end: '2026-12-31' });
  assert.deepEqual(math.parsePeriod('H1 2026'), { start: '2026-01-01', end: '2026-06-30' });
  assert.deepEqual(math.parsePeriod('2026'), { start: '2026-01-01', end: '2026-12-31' });
  assert.deepEqual(math.parsePeriod('Feb 2028'), { start: '2028-02-01', end: '2028-02-29' });
  assert.equal(math.parsePeriod('FY2026'), null);
  assert.equal(math.parsePeriod('next year'), null);
});
test('progressPct respects direction and is clamped to 0-100', () => {
  assert.equal(math.progressPct(18, 40), 45);
  assert.equal(math.progressPct(80, 40), 100);
  assert.equal(math.progressPct(18, 20, 'lower_better'), 100);
  assert.equal(math.progressPct(25, 20, 'lower_better'), 80);
  assert.equal(math.progressPct(null, 20), null);
  assert.equal(math.progressPct(5, 0), null);
});
test('krStatus: counts are paced against elapsed time; rates are judged against target', () => {
  const w = { start: '2026-10-01', end: '2026-12-31' };
  const count = (progress) => math.krStatus({ progress, current: progress, target: 100, direction: 'higher_better', pacing: true }, w, '2026-11-15');
  assert.equal(count(60), 'on_track');     // ~46% of the quarter gone
  assert.equal(count(35), 'at_risk');
  assert.equal(count(10), 'off_track');
  assert.equal(count(100), 'achieved');
  assert.equal(math.krStatus({ progress: 0, pacing: true }, w, '2026-10-06'), 'just_started'); // day 6 of 92: too early to judge
  assert.equal(math.krStatus({ progress: 50, pacing: true }, w, '2026-09-01'), 'not_started');
  assert.equal(math.krStatus({ progress: 60, pacing: true }, w, '2027-01-02'), 'missed');
  assert.equal(math.krStatus({ progress: null }, w, '2026-11-15'), 'no_data');
  const rate = math.krStatus({ progress: 100, current: 18, target: 20, direction: 'lower_better', pacing: false }, w, '2026-11-15');
  assert.equal(rate, 'on_track');
});
test('catalogue: every metric is fully described and guessMetricKey only matches real keys', () => {
  for (const m of catalogue.METRICS) {
    assert.ok(m.key && m.label && m.unit && m.description, m.key);
    assert.ok(['higher_better', 'lower_better', 'target_exact'].includes(m.direction), m.key);
    assert.ok(['flow', 'snapshot'].includes(m.kind), m.key);
    assert.equal(typeof m.compute, 'function', m.key);
    assert.ok(!m.cumulative || m.kind === 'flow', `${m.key}: only flow metrics can accumulate`);
  }
  assert.equal(new Set(catalogue.METRICS.map((m) => m.key)).size, catalogue.METRICS.length, 'unique keys');
  assert.equal(catalogue.guessMetricKey('Placements per month'), 'placements');
  assert.equal(catalogue.guessMetricKey('Cut time-to-place to 20 days'), 'avg_days_to_place');
  assert.equal(catalogue.guessMetricKey('Client satisfaction'), null);
  assert.equal(catalogue.guessMetricKey('Add 3 new client accounts'), null);
  assert.ok(catalogue.listMetrics().every((m) => !('compute' in m)));
});
test('schemas: auto KPI needs only a metric; metric goals need target + due date; key results validate by type', () => {
  const T = '22222222-2222-4222-8222-222222222222';
  assert.equal(schema.createKpiSchema.safeParse({ body: { teamId: T, metricKey: 'placements', targetValue: 6 } }).success, true);
  assert.equal(schema.createKpiSchema.safeParse({ body: { teamId: T } }).success, false);
  assert.equal(schema.createKpiSchema.safeParse({ body: { teamId: T, metricKey: 'bogus' } }).success, false);
  assert.equal(schema.createKpiSchema.safeParse({ body: { teamId: T, source: 'manual', metricKey: 'placements' } }).success, false);
  assert.equal(schema.createGoalSchema.safeParse({ body: { teamId: T, title: 'g', metricKey: 'placements', targetValue: 5, dueDate: '2026-12-31' } }).success, true);
  assert.equal(schema.createGoalSchema.safeParse({ body: { teamId: T, title: 'g', metricKey: 'placements', targetValue: 5 } }).success, false);
  assert.equal(schema.createGoalSchema.safeParse({ body: { teamId: T, title: 'g', targetValue: 5 } }).success, false);
  const strat = (kr) => schema.createStrategySchema.safeParse({ body: { teamId: T, title: 's', period: 'Q4 2026', objectives: [{ objective: 'o', key_results: [kr] }] } });
  assert.equal(strat({ kr: 'a', target: 1 }).success, true, 'old-style manual key results still validate');
  assert.equal(strat({ kr: 'a', target: 1, type: 'metric', metric_key: 'placements' }).success, true);
  assert.equal(strat({ kr: 'a', target: 1, type: 'metric' }).success, false);
  assert.equal(strat({ kr: 'a', target: 1, type: 'kpi' }).success, false);
  assert.equal(strat({ kr: 'a', target: 1, type: 'goal', goal_ids: [] }).success, false);
});
