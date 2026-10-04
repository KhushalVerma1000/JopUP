const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const schema = require('../src/features/daily-trackers/daily-trackers.schema');
const { renderDailyTrackerEmail, renderDailyTrackerText, summaryLine, esc } = require('../src/services/email/templates/dailyTracker');

const UUID = '11111111-1111-4111-8111-111111111111';
const summary = { active: 5, onHold: 1, newToday: 2, updatedToday: 1, joinedToday: 0, rejectedToday: 0, byStage: [] };
const columns = [{ key: 'name', label: 'Name' }, { key: 'stage', label: 'Stage' }];

test('every daily-tracker route requires authentication', async () => {
  for (const [m, url] of [['get', '/overview'], ['get', '/schedules'], ['post', '/schedules'], ['patch', `/schedules/${UUID}`], ['delete', `/schedules/${UUID}`], ['post', `/schedules/${UUID}/send`], ['get', `/schedules/${UUID}/runs`]]) {
    const res = await request(app)[m](`/api/v1/daily-trackers${url}`).send({});
    assert.equal(res.status, 401, `${m} ${url}`);
  }
});

test('email HTML escapes candidate-controlled text (this goes to clients)', () => {
  const html = renderDailyTrackerEmail({ title: 'T', dateLabel: 'D', summary, columns, senderName: 'JopUP', orgName: 'Acme',
    rows: [{ name: '<script>alert(1)</script> & "Co"', stage: 'Reached', change: 'new' }] });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('NEW'));
  assert.equal(esc(null), '');
});

test('text version groups by position and marks changes', () => {
  const text = renderDailyTrackerText({ title: 'Daily tracker — Zenith', dateLabel: 'Sunday', summary, rows: [
    { position: 'Sales', name: 'A', number: '1', stage: 'Reached', status: '', location: 'Pune', interview: '', change: 'updated' },
    { position: 'Sales', name: 'B', number: '2', stage: 'Applied', status: '', location: '', interview: '', change: null },
    { position: 'Ops', name: 'C', number: '3', stage: 'Interview', status: 'Reached at 3 pm', location: '', interview: '', change: 'new' }] });
  assert.match(text, /Sales\n1\. A — 1 — Pune — Reached \(updated\)\n2\. B — 2 — Applied\n\nOps\n1\. C — 3 — Interview — Reached at 3 pm \(new\)/);
  assert.equal(summaryLine(summary), '5 in pipeline · 1 on hold · 2 new · 1 updated');
});

test('schedule schema: time, days, emails', () => {
  const ok = (body) => schema.createScheduleSchema.safeParse({ body: { teamId: UUID, ...body } }).success;
  assert.equal(ok({}), true);
  assert.equal(ok({ sendTime: '18:00', sendDays: [1, 2, 3], toEmails: ['a@b.co'] }), true);
  assert.equal(ok({ sendTime: '6pm' }), false);
  assert.equal(ok({ sendTime: '24:00' }), false);
  assert.equal(ok({ sendDays: [] }), false);
  assert.equal(ok({ sendDays: [1, 1] }), false);
  assert.equal(ok({ sendDays: [8] }), false);
  assert.equal(ok({ toEmails: ['not-an-email'] }), false);
  assert.equal(ok({ toEmails: Array(21).fill('a@b.co') }), false);
  assert.equal(schema.updateScheduleSchema.safeParse({ body: {}, params: { id: UUID } }).success, false);
  assert.equal(schema.overviewSchema.safeParse({ query: { teamId: UUID, date: '2026-10-04' } }).success, true);
  assert.equal(schema.overviewSchema.safeParse({ query: { teamId: UUID, date: '04/10/2026' } }).success, false);
});
