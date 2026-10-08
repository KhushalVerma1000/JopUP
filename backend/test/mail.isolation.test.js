const test = require('node:test');
const assert = require('node:assert/strict');
const { assertSingleClient } = require('../src/features/mail/clientScope');
const { composeSchema } = require('../src/features/mail/mail.schema');
const mailService = require('../src/features/mail/mail.service');

const UUID = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const mk = (name, clientId, clientName, extra = {}) => ({
  id: name, candidateId: name, status: 'active', candidateName: name, candidatePhone: '+91 9' + name.length,
  candidateLocation: 'Pune', openPositionDesignation: 'Sales', clientId, clientName, lineupDate: new Date('2026-10-14T05:30:00Z'), ...extra,
});
const mixed = [mk('Asha Acme', A, 'Acme'), mk('Ravi Beta', B, 'Beta Corp'), mk('Neha Internal', null, null)];
const ctx = { tz: 'UTC', senderName: 'P', orgName: 'Zenith' };

test('compose accepts a client id, a null (internal) or none', () => {
  const body = { type: 'lineup', trackerIds: [UUID] };
  assert.ok(composeSchema.shape.body.safeParse({ ...body, clientId: UUID }).success);
  assert.ok(composeSchema.shape.body.safeParse({ ...body, clientId: null }).success);
  assert.ok(composeSchema.shape.body.safeParse(body).success);
  assert.ok(!composeSchema.shape.body.safeParse({ ...body, clientId: 'acme' }).success);
});

test('naming a client refuses anyone else\'s candidates instead of dropping them quietly', () => {
  assert.throws(() => assertSingleClient(mixed, A), /2 selected candidates belong to a different client/);
  assert.throws(() => assertSingleClient([mk('x', A, 'Acme'), mk('y', B, 'Beta')], A), /1 selected candidate belongs/);
  assert.equal(assertSingleClient([mk('x', A, 'Acme')], A).length, 1);
  assert.equal(assertSingleClient([mk('i', null, null)], null).length, 1, 'internal hires are their own group');
  assert.throws(() => assertSingleClient([mk('x', A, 'Acme')], null), /different client/);
});

test('with no client named, each lineup mail still contains only that client\'s people', async () => {
  const { messages } = await mailService._lineup(mixed, ctx);
  assert.equal(messages.length, 3);
  const acme = messages.find((m) => m.clientName === 'Acme');
  const beta = messages.find((m) => m.clientName === 'Beta Corp');
  for (const m of messages) {
    const own = m.clientName === 'Acme' ? 'Asha Acme' : m.clientName === 'Beta Corp' ? 'Ravi Beta' : 'Neha Internal';
    for (const body of [m.text, m.html, m.whatsappText]) {
      assert.ok(body.includes(own), `${m.clientName}: has its own candidate`);
      for (const other of ['Asha Acme', 'Ravi Beta', 'Neha Internal'].filter((n) => n !== own)) assert.ok(!body.includes(other), `${m.clientName} mail leaks ${other}`);
    }
  }
  assert.ok(!acme.text.includes('Beta') && !beta.text.includes('Acme'), 'client names do not cross either');
});
