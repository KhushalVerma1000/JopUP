const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStageLogs, mailLogGroups, candidateCustomFields } = require('../src/features/data-import/commit');

const NOW = new Date('2026-10-14T06:00:00Z');
const stages = ['applied', 'screening', 'lineup', 'turnup', 'interview', 'offer', 'joined']
  .map((k, i) => ({ id: `s-${k}`, stageKey: k, orderIndex: (i + 1) * 10, isFinalSuccess: k === 'joined' }));
const tz = 'Asia/Kolkata';
const build = (o) => buildStageLogs({ stages, tz, now: NOW, movedBy: 'u1', ...o });
const day = (d) => d.toISOString();

test('stage history: every stage walked is logged, closed as advanced, ending on the target', () => {
  const r = build({ targetKey: 'interview', status: 'active', dates: { lineup: '2026-10-10', interview: '2026-10-12' } });
  assert.deepEqual(r.logs.map((l) => l.stageId), ['s-applied', 's-screening', 's-lineup', 's-turnup', 's-interview']);
  assert.deepEqual(r.logs.map((l) => l.status), ['advanced', 'advanced', 'advanced', 'advanced', 'active']);
  assert.equal(r.logs[4].exitedAt, null);
  r.logs.slice(0, 4).forEach((l, i) => assert.equal(l.exitedAt.getTime(), r.logs[i + 1].enteredAt.getTime())); // no gaps
});

test('stage history: dates from the sheet, in the org timezone, never going backwards', () => {
  const r = build({ targetKey: 'interview', status: 'active', dates: { lineup: '2026-10-10', interview: '2026-10-12' } });
  assert.equal(day(r.logs[2].enteredAt), '2026-10-09T18:30:00.000Z');         // 10 Oct 00:00 in Kolkata
  assert.equal(day(r.logs[0].enteredAt), day(r.logs[2].enteredAt));             // earlier stages take the first known date
  assert.equal(day(r.logs[3].enteredAt), day(r.logs[2].enteredAt));             // turn-up has no date: same as lineup
  assert.equal(day(r.logs[4].enteredAt), '2026-10-11T18:30:00.000Z');          // interview on the 12th
  const odd = build({ targetKey: 'interview', status: 'active', dates: { lineup: '2026-10-12', interview: '2026-10-10' } });
  assert.ok(odd.logs.every((l, i) => i === 0 || l.enteredAt >= odd.logs[i - 1].enteredAt));
});

test('stage history: nothing is dated in the future, and no dates at all means now', () => {
  const up = build({ targetKey: 'lineup', status: 'active', dates: { lineup: '2026-10-20' } });
  assert.ok(up.logs.every((l) => l.enteredAt <= NOW));
  const none = build({ targetKey: 'screening', status: 'active', dates: {} });
  assert.equal(none.logs[0].enteredAt.getTime(), NOW.getTime());
});

test('stage history: how each ending is recorded', () => {
  const rej = build({ targetKey: 'lineup', status: 'rejected', reason: 'No show', dates: { lineup: '2026-10-10' } });
  const last = rej.logs[rej.logs.length - 1];
  assert.equal(last.status, 'blocked'); assert.equal(last.blockReason, 'No show'); assert.ok(last.exitedAt);
  assert.equal(build({ targetKey: 'lineup', status: 'withdrawn', reason: 'Not interested', dates: {} }).logs.pop().status, 'withdrawn');
  const hold = build({ targetKey: 'interview', status: 'on_hold', dates: {} }).logs.pop();
  assert.equal(hold.status, 'held'); assert.ok(hold.exitedAt); assert.equal(hold.blockReason, null);
  const joined = build({ targetKey: 'joined', status: 'placed', dates: { lineup: '2026-10-01', interview: '2026-10-05', joining: '2026-10-12' } });
  assert.equal(joined.status, 'placed'); assert.equal(joined.logs.length, 7);
  assert.equal(joined.logs.pop().status, 'active');                                  // final stage stays open, as when advanced live
});

test('stage history: "placed" without a final stage in the pipeline is downgraded, and says so', () => {
  const noFinal = stages.filter((s) => s.stageKey !== 'joined');
  const r = buildStageLogs({ stages: noFinal, targetKey: 'offer', status: 'placed', dates: {}, tz, now: NOW });
  assert.equal(r.status, 'active'); assert.equal(r.downgraded, true);
});

test('stage history: a stage that is not in the pipeline falls back to the first', () => {
  const r = build({ targetKey: 'nonsense', status: 'active', dates: {} });
  assert.equal(r.logs.length, 1); assert.equal(r.logs[0].stageId, 's-applied');
  assert.throws(() => buildStageLogs({ stages: [], targetKey: 'x', status: 'active', tz, now: NOW }));
});

test('mail logs: only today or later, one per client, location, type and day', () => {
  const g = mailLogGroups([
    { trackerId: 't1', clientId: 'c1', locationId: 'l1', lineupDay: '2026-10-14', interviewDay: null },
    { trackerId: 't2', clientId: 'c1', locationId: 'l1', lineupDay: '2026-10-14', interviewDay: '2026-10-16' },
    { trackerId: 't3', clientId: 'c1', locationId: null, lineupDay: '2026-10-14', interviewDay: null },
    { trackerId: 't4', clientId: 'c1', locationId: 'l1', lineupDay: '2026-10-13', interviewDay: null },   // yesterday
    { trackerId: 't5', clientId: null, locationId: null, lineupDay: '2026-10-15', interviewDay: null },   // no client
  ], '2026-10-14');
  assert.deepEqual(g.map((x) => [x.mailType, x.day, x.locationId, x.trackerIds]), [
    ['lineup', '2026-10-14', 'l1', ['t1', 't2']], ['lineup', '2026-10-14', null, ['t3']], ['interview_schedule', '2026-10-16', 'l1', ['t2']]]);
});

test('custom fields use the names the rest of the product reads', () => {
  const f = candidateCustomFields({ experienceYears: 3.5, altPhone: '90000 11111' }, { currentCtc: '6.5 LPA', noticePeriod: '30 days', 'Blood group': 'B+', resumeLink: 'x' });
  assert.deepEqual(f, { experience: '3.5', current_ctc: '6.5 LPA', notice_period: '30 days', alt_phone: '90000 11111', 'Blood group': 'B+' });
});
