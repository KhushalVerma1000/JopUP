/**
 * The Today view's backend against a real, seeded database. Opt-in, like the other live suites:
 *
 *   npm run db:seed && npm run db:seed:demo -- --reset
 *   JOPUP_LIVE_TESTS=1 node --test test/trackers.today.live.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const live = process.env.JOPUP_LIVE_TESTS === '1';
const t = (name, fn) => test(name, { skip: !live && 'set JOPUP_LIVE_TESTS=1 (needs seeded demo data)' }, fn);

let request; let app; let pool;
const tokens = {};
let tracker; let original;
const as = (who) => ({
  get: (u) => request(app).get(`/api/v1${u}`).set('Authorization', `Bearer ${tokens[who]}`),
  patch: (u, b) => request(app).patch(`/api/v1${u}`).set('Authorization', `Bearer ${tokens[who]}`).send(b),
  post: (u, b) => request(app).post(`/api/v1${u}`).set('Authorization', `Bearer ${tokens[who]}`).send(b),
});
const row = async () => (await as('hr').get('/trackers')).body.data.trackers.find((x) => x.id === tracker.id);
const iso = (d) => new Date(Date.UTC(2026, 10, d, 5, 30)).toISOString();
const clean = () => pool.query(`delete from candidate_tracker_action where stage_log_id in (select id from candidate_tracker_stage_log where tracker_id = $1) and metadata->>'kind' in ('reschedule','not_coming','confirmed')`, [tracker.id]);

test.before(async () => {
  if (!live) return;
  request = require('supertest'); app = require('../src/app'); pool = require('../src/utils/db').pool;
  for (const [k, email] of Object.entries({ hr: 'hr.tech@acme.test', otherHr: 'hr.sales@acme.test' })) {
    tokens[k] = (await request(app).post('/api/v1/auth/login').send({ email, password: 'Password123!' })).body.data.token;
  }
  tracker = (await as('hr').get('/trackers')).body.data.trackers.find((x) => x.status === 'active');
  assert.ok(tracker, 'the demo data has an active tracker in Tech Hiring');
  original = { lineupDate: tracker.lineupDate, interviewDate: tracker.interviewDate };
  await clean();
  await pool.query('update candidate_tracker set lineup_date = null, interview_date = null where id = $1', [tracker.id]);
});
test.after(async () => {
  if (!pool) return;
  await clean();
  await pool.query('update candidate_tracker set lineup_date = $2, interview_date = $3 where id = $1', [tracker.id, original.lineupDate, original.interviewDate]);
  await pool.end();
});

t('the tracker list carries the Today fields, all empty to start with', async () => {
  const r = await row();
  assert.equal(r.rescheduleCount, 0);
  assert.equal(r.notComingAt, null);
  assert.equal(r.confirmedFor, null);
});

t('setting a date the first time is not a reschedule; moving it is; saving the same day again is not', async () => {
  assert.equal((await as('hr').patch(`/trackers/${tracker.id}`, { lineupDate: iso(13) })).status, 200);
  assert.equal((await row()).rescheduleCount, 0);
  assert.equal((await as('hr').patch(`/trackers/${tracker.id}`, { lineupDate: iso(14) })).status, 200);
  assert.equal((await row()).rescheduleCount, 1);
  assert.equal((await as('hr').patch(`/trackers/${tracker.id}`, { lineupDate: iso(14) })).status, 200);
  assert.equal((await row()).rescheduleCount, 1);
  assert.equal((await as('hr').patch(`/trackers/${tracker.id}`, { notes: 'unrelated edit' })).status, 200);
  assert.equal((await row()).rescheduleCount, 1);
});

t('a bulk date change counts as a reschedule too', async () => {
  const res = await as('hr').post('/trackers/bulk/dates', { trackerIds: [tracker.id], field: 'lineupDate', mode: 'same', at: iso(16) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await row()).rescheduleCount, 2);
});

t('not coming is recorded, the candidate stays where they were', async () => {
  const stageBefore = (await row()).currentStage.id;
  const res = await as('hr').post(`/trackers/${tracker.id}/outcome`, { outcome: 'not_coming', field: 'lineupDate' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const r = await row();
  assert.ok(r.notComingAt);
  assert.equal(r.currentStage.id, stageBefore);
  assert.equal(r.status, 'active');
});

t('a later confirmation replaces not coming, and remembers which day it was for', async () => {
  const res = await as('hr').post(`/trackers/${tracker.id}/outcome`, { outcome: 'confirmed', field: 'lineupDate', forDate: '2026-11-16' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const r = await row();
  assert.equal(r.confirmedFor, '2026-11-16');
  assert.equal(r.notComingAt, null);
});

t('bad input is refused, and nothing is recorded for it', async () => {
  const before = (await pool.query("select count(*)::int n from candidate_tracker_action where metadata->>'kind' in ('not_coming','confirmed')")).rows[0].n;
  assert.equal((await as('hr').post(`/trackers/${tracker.id}/outcome`, { outcome: 'rejected' })).status, 400);
  assert.equal((await as('hr').post(`/trackers/${tracker.id}/outcome`, { outcome: 'confirmed', forDate: 'tomorrow' })).status, 400);
  const after = (await pool.query("select count(*)::int n from candidate_tracker_action where metadata->>'kind' in ('not_coming','confirmed')")).rows[0].n;
  assert.equal(after, before);
});

t('HR from another team cannot see or answer for this candidate', async () => {
  const res = await as('otherHr').post(`/trackers/${tracker.id}/outcome`, { outcome: 'not_coming' });
  assert.equal(res.status, 404);
});

t('a candidate who is on hold cannot be answered for', async () => {
  assert.equal((await as('hr').post(`/trackers/${tracker.id}/hold`, {})).status, 200);
  const res = await as('hr').post(`/trackers/${tracker.id}/outcome`, { outcome: 'not_coming' });
  assert.equal(res.status, 400);
  assert.equal((await as('hr').post(`/trackers/${tracker.id}/resume`, {})).status, 200);
});
