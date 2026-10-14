const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const schema = require('../src/features/automation/automation.schema');
const { planAutomation, triggerOptions, isKnownTrigger } = require('../src/features/automation/automation.service');

const stage = (id, orderIndex, name = id) => ({ id, orderIndex, name });
const LINEUP = stage('s-lineup', 30, 'Line-up');
const row = (id, status = 'active', cur = stage('s-screening', 20), wf = 'wf1') => ({ id, status, workflowTemplateId: wf, currentStage: cur });

test('automation routes require authentication', async () => {
  for (const [m, p] of [['get', '/options'], ['get', '/rules'], ['post', '/rules'], ['patch', '/rules/x'], ['delete', '/rules/x']]) {
    assert.equal((await request(app)[m](`/api/v1/automation${p}`).send({})).status, 401, `${m} ${p}`);
  }
});

test('createRuleSchema: needs a name, a known kind of trigger and a target stage', () => {
  const ok = { name: 'Lineup set', trigger: 'date_set', triggerKey: 'lineupDate', targetStageKey: 'lineup' };
  assert.ok(schema.createRuleSchema.safeParse({ body: ok }).success);
  assert.ok(!schema.createRuleSchema.safeParse({ body: { ...ok, name: ' ' } }).success);
  assert.ok(!schema.createRuleSchema.safeParse({ body: { ...ok, trigger: 'cron' } }).success);
  assert.ok(!schema.createRuleSchema.safeParse({ body: { ...ok, targetStageKey: '' } }).success);
  assert.ok(!schema.updateRuleSchema.safeParse({ params: { id: '11111111-1111-4111-8111-111111111111' }, body: {} }).success);
});

test('triggers: the two dates and every client mail type, nothing else', () => {
  assert.ok(isKnownTrigger('date_set', 'lineupDate'));
  assert.ok(isKnownTrigger('date_set', 'interviewDate'));
  assert.ok(isKnownTrigger('mail_sent', 'offer'));
  assert.ok(!isKnownTrigger('date_set', 'notes'));
  assert.ok(!isKnownTrigger('mail_sent', 'nope'));
  assert.equal(new Set(triggerOptions().map((o) => `${o.trigger}:${o.key}`)).size, triggerOptions().length);
});

test('planAutomation: moves active candidates forward only', () => {
  const plan = planAutomation({ rows: [row('a'), row('b', 'active', null)], stageFor: () => LINEUP });
  assert.deepEqual(plan.map((p) => p.stageId), ['s-lineup', 's-lineup']);
});

test('planAutomation: never backwards, never twice, never for held/closed candidates', () => {
  const plan = planAutomation({
    rows: [
      row('past', 'active', stage('s-interview', 50)),
      row('same', 'active', LINEUP),
      row('hold', 'on_hold'), row('rej', 'rejected'), row('placed', 'placed'), row('out', 'withdrawn'),
    ],
    stageFor: () => LINEUP,
  });
  assert.ok(plan.every((p) => p.skip), JSON.stringify(plan));
  assert.equal(plan[0].skip, 'already past it');
  assert.equal(plan[1].skip, 'already there');
});

test('planAutomation: a workflow without that stage is skipped, others still move', () => {
  const plan = planAutomation({ rows: [row('a', 'active', stage('x', 10), 'wf1'), row('b', 'active', stage('y', 10), 'wf2')], stageFor: (t) => (t === 'wf1' ? LINEUP : null) });
  assert.equal(plan[0].stageId, 's-lineup');
  assert.equal(plan[1].skip, 'no such stage in this workflow');
});
