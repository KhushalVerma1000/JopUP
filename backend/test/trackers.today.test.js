const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const schema = require('../src/features/trackers/trackers.schema');
const { isReschedule, summariseActions, KIND } = require('../src/features/trackers/trackers.today');

const ID = '11111111-1111-4111-8111-111111111111';

test('the outcome route needs a signed-in user', async () => {
  assert.equal((await request(app).post(`/api/v1/trackers/${ID}/outcome`).send({ outcome: 'not_coming' })).status, 401);
});

test('outcomeSchema: only not_coming and confirmed; forDate is a plain day', () => {
  const ok = (body, params = { id: ID }) => schema.outcomeSchema.safeParse({ params, body }).success;
  assert.ok(ok({ outcome: 'not_coming' }));
  assert.ok(ok({ outcome: 'confirmed', field: 'lineupDate', forDate: '2026-11-14' }));
  assert.ok(!ok({ outcome: 'rejected' }), 'a stage change is not an outcome');
  assert.ok(!ok({ outcome: 'confirmed', forDate: '14/11/2026' }));
  assert.ok(!ok({ outcome: 'confirmed', field: 'notes' }));
  assert.ok(!ok({ outcome: 'not_coming' }, { id: 'nope' }));
  assert.ok(!ok({ outcome: 'not_coming', note: 'x'.repeat(501) }));
});

test('isReschedule: a move counts; a first-time set, a clear and a same value do not', () => {
  const a = new Date('2026-11-13T10:00:00Z');
  const b = new Date('2026-11-14T10:00:00Z');
  assert.equal(isReschedule(a, b), true);
  assert.equal(isReschedule(a.toISOString(), b), true, 'mixed ISO string and Date');
  assert.equal(isReschedule(null, b), false, 'first time a date is set');
  assert.equal(isReschedule(a, null), false, 'clearing a date');
  assert.equal(isReschedule(a, new Date(a)), false, 'same instant');
  assert.equal(isReschedule(undefined, undefined), false);
});

test('summariseActions: counts moves, keeps the latest word between confirmed and not coming', () => {
  const row = (trackerId, performedAt, metadata) => ({ trackerId, performedAt, metadata });
  const m = summariseActions([
    row('a', '2026-11-12T10:00:00Z', { kind: KIND.RESCHEDULE }),
    row('a', '2026-11-12T11:00:00Z', { kind: KIND.RESCHEDULE }),
    row('a', '2026-11-12T12:00:00Z', { kind: KIND.CONFIRMED, forDate: '2026-11-13' }),
    row('a', '2026-11-12T13:00:00Z', { kind: KIND.NOT_COMING }),
    row('b', '2026-11-12T13:00:00Z', { kind: KIND.NOT_COMING }),
    row('b', '2026-11-12T14:00:00Z', { kind: KIND.CONFIRMED, forDate: '2026-11-14' }),
    row('c', '2026-11-12T14:00:00Z', { kind: 'note' }),
    row('c', '2026-11-12T14:00:00Z', null),
  ]);
  assert.deepEqual(m.get('a'), { rescheduleCount: 2, notComingAt: '2026-11-12T13:00:00.000Z', confirmedFor: null });
  assert.deepEqual(m.get('b'), { rescheduleCount: 0, notComingAt: null, confirmedFor: '2026-11-14' });
  assert.equal(m.has('c'), false, 'unrelated actions are ignored');
});

test('summariseActions does not depend on the order rows arrive in', () => {
  const rows = [
    { trackerId: 'a', performedAt: '2026-11-12T13:00:00Z', metadata: { kind: KIND.NOT_COMING } },
    { trackerId: 'a', performedAt: '2026-11-12T12:00:00Z', metadata: { kind: KIND.CONFIRMED, forDate: '2026-11-13' } },
  ];
  assert.deepEqual(summariseActions(rows), summariseActions([...rows].reverse()));
});
