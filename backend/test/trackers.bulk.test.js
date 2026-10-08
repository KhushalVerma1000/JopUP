const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const schema = require('../src/features/trackers/trackers.schema');
const { planDates, planStatus } = require('../src/features/trackers/trackers.bulk.service');

const U = (n) => `11111111-1111-4111-8111-11111111111${n}`;
const t = (id, status = 'active', extra = {}) => ({ id, status, workflowTemplateId: 'wf1', currentStage: { id: 's-lineup', name: 'Lined up', orderIndex: 20 }, ...extra });

test('bulk routes require authentication', async () => {
  assert.equal((await request(app).post('/api/v1/trackers/bulk/dates').send({})).status, 401);
  assert.equal((await request(app).post('/api/v1/trackers/bulk/status').send({})).status, 401);
});

test('bulkDatesSchema: each mode asks for what it needs', () => {
  const base = { trackerIds: [U(1)], field: 'interviewDate' };
  const at = '2026-10-14T05:30:00.000Z';
  assert.ok(schema.bulkDatesSchema.safeParse({ body: { ...base, mode: 'same', at } }).success);
  assert.ok(!schema.bulkDatesSchema.safeParse({ body: { ...base, mode: 'same' } }).success);
  assert.ok(schema.bulkDatesSchema.safeParse({ body: { ...base, mode: 'stagger', start: at, gapMinutes: 30 } }).success);
  assert.ok(!schema.bulkDatesSchema.safeParse({ body: { ...base, mode: 'stagger', start: at } }).success);
  assert.ok(schema.bulkDatesSchema.safeParse({ body: { ...base, mode: 'clear' } }).success);
  assert.ok(!schema.bulkDatesSchema.safeParse({ body: { ...base, field: 'notes', mode: 'clear' } }).success);
  assert.ok(!schema.bulkDatesSchema.safeParse({ body: { ...base, trackerIds: [], mode: 'clear' } }).success);
  assert.ok(!schema.bulkDatesSchema.safeParse({ body: { ...base, trackerIds: Array(201).fill(U(1)), mode: 'clear' } }).success);
});

test('bulkStatusSchema: advance needs a stage, block needs a reason', () => {
  const ids = [U(1)];
  assert.ok(schema.bulkStatusSchema.safeParse({ body: { trackerIds: ids, action: 'advance', nextStageId: U(2), note: 'Reached' } }).success);
  assert.ok(!schema.bulkStatusSchema.safeParse({ body: { trackerIds: ids, action: 'advance' } }).success);
  assert.ok(!schema.bulkStatusSchema.safeParse({ body: { trackerIds: ids, action: 'block' } }).success);
  assert.ok(schema.bulkStatusSchema.safeParse({ body: { trackerIds: ids, action: 'block', reason: 'Not interested' } }).success);
  assert.ok(schema.bulkStatusSchema.safeParse({ body: { trackerIds: ids, action: 'hold', dryRun: true } }).success);
  assert.ok(!schema.bulkStatusSchema.safeParse({ body: { trackerIds: ids, action: 'delete' } }).success);
});

test('planDates: same time for everyone; closed candidates are skipped', () => {
  const at = '2026-10-14T05:30:00.000Z';
  const plan = planDates({ rows: [t('a'), t('b', 'placed'), t('c', 'on_hold')], mode: 'same', at });
  assert.equal(plan[0].value.toISOString(), at);
  assert.match(plan[1].skip, /placed/);
  assert.equal(plan[2].value.toISOString(), at, 'on hold can still be given a date');
});

test('planDates: stagger follows the selected order and does not spend slots on skipped rows', () => {
  const start = '2026-10-14T05:30:00.000Z';
  const plan = planDates({ rows: [t('a'), t('x', 'rejected'), t('b'), t('c')], mode: 'stagger', start, gapMinutes: 30 });
  assert.deepEqual(plan.filter((p) => p.value).map((p) => p.value.toISOString()), ['2026-10-14T05:30:00.000Z', '2026-10-14T06:00:00.000Z', '2026-10-14T06:30:00.000Z']);
  assert.ok(plan[1].skip);
});

test('planDates: clear writes null', () => {
  assert.equal(planDates({ rows: [t('a')], mode: 'clear' })[0].value, null);
});

const interview = { id: 's-int', name: 'Interview Scheduled', stageKey: 'interview', orderIndex: 30, workflowTemplateId: 'wf1' };

test('planStatus advance: moves forward, skips ones already there or past, with reasons', () => {
  const rows = [
    t('a'),
    t('b', 'active', { currentStage: { id: 's-int', name: 'Interview Scheduled', orderIndex: 30 } }),
    t('c', 'active', { currentStage: { id: 's-offer', name: 'Offered', orderIndex: 50 } }),
    t('d', 'on_hold'),
  ];
  const plan = planStatus({ action: 'advance', rows, target: interview, stageFor: () => null });
  assert.equal(plan[0].stageId, 's-int');
  assert.match(plan[1].skip, /Already in Interview Scheduled/);
  assert.match(plan[2].skip, /Already past/);
  assert.match(plan[3].skip, /on hold/);
});

test('planStatus advance: a candidate on another workflow moves via the matching stageKey, else is skipped', () => {
  const rows = [t('a', 'active', { workflowTemplateId: 'wf2' }), t('b', 'active', { workflowTemplateId: 'wf3' })];
  const stageFor = (tpl) => (tpl === 'wf2' ? { id: 's2-int', name: 'Interview Scheduled', orderIndex: 30 } : null);
  const plan = planStatus({ action: 'advance', rows, target: interview, stageFor });
  assert.equal(plan[0].stageId, 's2-int');
  assert.match(plan[1].skip, /No "Interview Scheduled" stage/);
});

test('planStatus hold / resume / block respect current status', () => {
  const rows = [t('a', 'active'), t('b', 'on_hold'), t('c', 'placed')];
  const hold = planStatus({ action: 'hold', rows });
  assert.deepEqual(hold.map((p) => Boolean(p.skip)), [false, true, true]);
  const resume = planStatus({ action: 'resume', rows });
  assert.deepEqual(resume.map((p) => Boolean(p.skip)), [true, false, true]);
  const block = planStatus({ action: 'block', rows });
  assert.deepEqual(block.map((p) => Boolean(p.skip)), [false, false, true]);
});
