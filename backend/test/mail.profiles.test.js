const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const { matchLocation } = require('../src/features/mail/locationMatch');
const { markSentSchema } = require('../src/features/mail/mail.schema');
const loc = require('../src/features/clients/locations.schema');

const UUID = '11111111-1111-4111-8111-111111111111';
const LOCS = [
  { id: 'alg', name: 'Aligarh store', aliases: ['Aligarh', 'ALG', 'Aligarh UP'] },
  { id: 'noi', name: 'Noida store', aliases: ['Noida', 'Greater Noida'] },
];

test('location match: names, aliases, extra words around the alias', () => {
  assert.equal(matchLocation('Aligarh', LOCS), 'alg');
  assert.equal(matchLocation('  aligarh, UP ', LOCS), 'alg');
  assert.equal(matchLocation('ALG', LOCS), 'alg');
  assert.equal(matchLocation('Sector 62, Noida', LOCS), 'noi');
  assert.equal(matchLocation('Greater Noida', LOCS), 'noi', 'the longer alias wins over "Noida"');
});

test('location match: unknown, empty and ambiguous locations match nothing', () => {
  assert.equal(matchLocation('Pune', LOCS), null);
  assert.equal(matchLocation('', LOCS), null);
  assert.equal(matchLocation(null, LOCS), null);
  const clash = [...LOCS, { id: 'x', name: 'Aligarh road', aliases: ['Aligarh'] }];
  assert.equal(matchLocation('Aligarh', clash), null, 'two locations claim it: never guess');
  assert.equal(matchLocation('Alig', LOCS), null, 'whole words only');
});

test('profile and mark-sent routes require authentication', async () => {
  for (const [m, p] of [
    ['get', `/api/v1/clients/${UUID}/mail-profile`], ['get', `/api/v1/clients/${UUID}/mail-log`],
    ['post', `/api/v1/clients/${UUID}/locations`], ['patch', `/api/v1/clients/${UUID}/locations/${UUID}`],
    ['delete', `/api/v1/clients/${UUID}/locations/${UUID}`], ['post', `/api/v1/clients/${UUID}/contacts`],
    ['post', '/api/v1/mail/sent'],
  ]) assert.equal((await request(app)[m](p)).status, 401, `${m} ${p}`);
});

test('location and contact input is checked and tidied', () => {
  const c = loc.createLocationSchema.shape.body;
  const ok = c.parse({ name: ' Aligarh store ', aliases: ['Aligarh', 'aligarh', 'ALG'] });
  assert.equal(ok.name, 'Aligarh store');
  assert.equal(ok.aliases.length, 2);
  assert.ok(!c.safeParse({ name: '' }).success);
  const k = loc.createContactSchema.shape.body;
  assert.ok(!k.safeParse({ name: 'M', email: 'not-an-email' }).success);
  const good = k.parse({ name: 'Meera', email: 'Meera@Northline.example' });
  assert.equal(good.email, 'meera@northline.example');
  assert.equal(good.mailRole, 'to');
  assert.ok(!k.safeParse({ name: 'M', email: 'a@b.co', mailRole: 'bcc' }).success);
  assert.ok(!loc.updateContactSchema.shape.body.safeParse({}).success);
  const patch = loc.updateContactSchema.shape.body.parse({ phone: '98100' });
  assert.deepEqual(Object.keys(patch), ['phone'], 'an edit never resets fields it did not send');
});

test('mark-sent needs a client, a subject and at least one candidate', () => {
  const b = markSentSchema.shape.body;
  const good = { clientId: UUID, subject: 'Lineup', trackerIds: [UUID], to: [{ email: 'a@b.co' }] };
  assert.ok(b.safeParse(good).success);
  assert.ok(!b.safeParse({ ...good, clientId: undefined }).success);
  assert.ok(!b.safeParse({ ...good, trackerIds: [] }).success);
  assert.ok(!b.safeParse({ ...good, to: [{ email: 'nope' }] }).success);
});
