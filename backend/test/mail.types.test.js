const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const types = require('../src/features/mail/types');
const { buildOptions, OTHER, ALL } = require('../src/features/mail/options.service');
const { composeSchema, optionsSchema, markSentSchema } = require('../src/features/mail/mail.schema');
const { isKnownKey } = require('../src/features/mail/columns');
const mailService = require('../src/features/mail/mail.service');

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UUID = '11111111-1111-4111-8111-111111111111';
const profiles = new Map([[A, { locations: [{ id: 'alg', name: 'Aligarh', aliases: ['Aligarh UP'] }, { id: 'noi', name: 'Noida', aliases: [] }], contacts: [] }]]);
const mk = (id, clientId, loc, extra = {}) => ({ id, status: 'active', clientId, clientName: clientId === A ? 'Acme' : 'Beta', candidateLocation: loc, candidatePhone: '9', currentStage: { stageKey: 'lineup' }, lineupDate: '2026-10-14T05:30:00Z', ...extra });
const all = [mk('1', A, 'Aligarh'), mk('2', A, 'Aligarh UP'), mk('3', A, 'Noida', { lineupDate: '2026-10-15T05:30:00Z' }), mk('4', A, 'Pune'), mk('5', B, 'Pune'), mk('6', null, 'Pune'), mk('7', A, 'Aligarh', { lineupDate: null })];
const lineup = types.get('lineup');
const opt = (extra, type = lineup, trackers = all) => buildOptions({ type, trackers, profiles, tz: 'Asia/Kolkata', ...extra });

test('every registered mail type is well formed and uses real columns', () => {
  assert.ok(types.TYPES.length >= 6);
  for (const t of types.TYPES) {
    assert.ok(t.key && t.label && t.blurb && t.audience === 'client', t.key);
    assert.ok(t.needs[0] === 'client' && t.needs.includes('location'), `${t.key}: client then location`);
    assert.equal(t.needs.includes('date'), !!t.dateField, `${t.key}: a date step needs a date field`);
    assert.ok(t.columns.length && t.columns.every(isKnownKey), `${t.key}: unknown column`);
  }
  assert.ok(types.describe().every((t) => !t.columns && !t.statuses), 'the API shows cards, not internals');
});

test('step 1 lists only clients with candidates, never internal hires', () => {
  const o = opt({});
  assert.deepEqual(o.clients.map((c) => [c.name, c.count]), [['Acme', 4], ['Beta', 1]]);
  assert.deepEqual(o.locations, []);
});

test('step 2 groups one client\'s candidates by hiring location; unmatched are shown, not hidden', () => {
  const o = opt({ clientId: A });
  assert.deepEqual(o.locations.map((l) => [l.id, l.count]), [[ALL, 4], ['alg', 2], ['noi', 1], [OTHER, 1]]);
  assert.ok(o.locations.find((l) => l.id === OTHER).unmatched);
  assert.ok(!JSON.stringify(o).includes('"5"'), "Beta's candidate never shows up under Acme");
});

test('step 3 offers the days that have candidates, in order, and counts undated ones', () => {
  const o = opt({ clientId: A, locationId: 'alg' });
  assert.deepEqual(o.dates, [{ date: '2026-10-14', count: 2 }]);
  assert.equal(o.undated, 1, 'one Acme candidate has no lineup date: reported, not counted');
  assert.deepEqual(opt({ clientId: A, locationId: ALL }).dates.map((d) => d.date), ['2026-10-14', '2026-10-15']);
});

test('the picked day returns exactly that location\'s candidates for that client', () => {
  assert.deepEqual(opt({ clientId: A, locationId: 'alg', date: '2026-10-14' }).trackerIds.sort(), ['1', '2']);
  assert.deepEqual(opt({ clientId: A, locationId: ALL, date: '2026-10-15' }).trackerIds, ['3']);
  assert.deepEqual(opt({ clientId: A, locationId: 'noi', date: '2026-10-14' }).trackerIds, []);
});

test('the day is the organisation\'s local day, not UTC', () => {
  const late = [mk('9', A, 'Noida', { lineupDate: '2026-10-14T20:00:00Z' })]; // 01:30 on the 15th in Kolkata
  assert.equal(opt({ clientId: A, locationId: 'noi' }, lineup, late).dates[0].date, '2026-10-15');
});

test('types without a day skip the date step; stage and status rules apply', () => {
  const offer = types.get('offer');
  const rows = [mk('1', A, 'Aligarh', { currentStage: { stageKey: 'offer' } }), mk('2', A, 'Aligarh'), mk('3', A, 'Aligarh', { currentStage: { stageKey: 'offer' }, status: 'rejected' })];
  const o = opt({ clientId: A, locationId: 'alg' }, offer, rows);
  assert.deepEqual(o.trackerIds, ['1'], 'only live candidates at the offer stage');
  const joining = opt({ clientId: A, locationId: 'alg' }, types.get('joining'), [mk('1', A, 'Aligarh', { currentStage: { stageKey: 'joined' }, status: 'placed' })]);
  assert.deepEqual(joining.trackerIds, ['1']);
});

test('a client with no hiring locations still gets a way forward', () => {
  const o = buildOptions({ type: lineup, trackers: [mk('1', B, 'Pune')], profiles: new Map([[B, { locations: [], contacts: [] }]]), clientId: B, tz: 'UTC' });
  assert.deepEqual(o.locations.map((l) => [l.id, l.name]), [[OTHER, 'No hiring location set up']]);
});

test('ready-to-send checks say what to fix', () => {
  const list = [mk('1', A, 'Aligarh', { lineupDate: null }), mk('2', A, 'Aligarh', { candidatePhone: '' })];
  const none = mailService._checks({ kind: lineup, list, recipients: { to: [] }, locationUnmatched: true, clientId: A });
  assert.deepEqual(none.map((c) => c.id), ['no_to', 'location_unmatched', 'no_date', 'no_phone']);
  assert.equal(none[0].level, 'error');
  assert.equal(none[0].fixTo, `/clients/${A}`);
  assert.deepEqual(mailService._checks({ kind: lineup, list: [mk('1', A, 'Aligarh')], recipients: { to: [{ email: 'a@b.c' }] }, locationUnmatched: false, clientId: A }), []);
});

test('schemas accept known mail types and reject made-up ones', () => {
  const body = { type: 'tracker', trackerIds: [UUID], mailType: 'offer', date: '2026-10-14' };
  assert.ok(composeSchema.shape.body.safeParse(body).success);
  assert.ok(!composeSchema.shape.body.safeParse({ ...body, mailType: 'spam' }).success);
  assert.ok(optionsSchema.shape.query.safeParse({ type: 'lineup', clientId: UUID, locationId: 'all', date: '2026-10-14' }).success);
  assert.ok(optionsSchema.shape.query.safeParse({ type: 'lineup', locationId: 'other' }).success);
  assert.ok(!optionsSchema.shape.query.safeParse({ type: 'nope' }).success);
  assert.ok(!optionsSchema.shape.query.safeParse({ type: 'lineup', locationId: 'x' }).success);
  assert.ok(markSentSchema.shape.body.safeParse({ clientId: UUID, subject: 's', trackerIds: [UUID], mailType: 'lineup' }).success);
});

test('the new routes require authentication', async () => {
  for (const p of ['/api/v1/mail/types', '/api/v1/mail/options?type=lineup']) assert.equal((await request(app).get(p)).status, 401, p);
});

const { buildPending } = require('../src/features/mail/options.service');
test('pending list: what is still to send, per client, location and day, from today on', () => {
  const trackers = [
    mk('1', A, 'Aligarh'), mk('2', A, 'Aligarh UP'), mk('3', A, 'Noida', { lineupDate: '2026-10-15T05:30:00Z' }),
    mk('4', A, 'Aligarh', { lineupDate: '2026-10-10T05:30:00Z' }),       // yesterday: not pending
    mk('5', B, 'Pune'), mk('6', null, 'Pune'),                            // internal hire: never
    mk('7', A, 'Aligarh', { lineupDate: null, interviewDate: '2026-10-14T08:00:00Z' }),
  ];
  const run = (logs) => buildPending({ trackers, profiles, logs, tz: 'Asia/Kolkata', today: '2026-10-14', until: '2026-10-28' });
  const none = run([]);
  assert.deepEqual(none.map((p) => [p.type, p.clientName, p.locationName, p.date, p.count, p.sent]), [
    ['interview_schedule', 'Acme', 'Aligarh', '2026-10-14', 1, false],
    ['lineup', 'Acme', 'Aligarh', '2026-10-14', 2, false],
    ['lineup', 'Beta', 'No hiring location set up', '2026-10-14', 1, false],
    ['lineup', 'Acme', 'Noida', '2026-10-15', 1, false],
  ]);

  const at = new Date('2026-10-13T10:00:00Z');
  const full = run([{ clientId: A, locationId: 'alg', mailType: 'lineup', trackerIds: ['1', '2'], sentAt: at, first: 'Priya' }]);
  const l = full.find((p) => p.type === 'lineup' && p.locationName === 'Aligarh');
  assert.ok(l.sent && !l.partlySent && l.lastSent.by === 'Priya');
  const wrongType = full.find((p) => p.type === 'interview_schedule');
  assert.ok(!wrongType.sent, 'a lineup mail does not count as the interview schedule being sent');

  const partial = run([{ clientId: A, locationId: 'alg', mailType: 'lineup', trackerIds: ['1'], sentAt: at }]).find((p) => p.type === 'lineup' && p.locationName === 'Aligarh');
  assert.ok(!partial.sent && partial.partlySent && partial.unsent === 1, 'someone added after sending → follow-up due');
});
test('pending route requires authentication', async () => {
  assert.equal((await request(app).get('/api/v1/mail/pending')).status, 401);
});
