const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../src/utils/trial');

test('trialFor: 30 days by default, 90 only when selected', () => {
  assert.deepEqual(t.trialFor(false), { tier: 'standard', days: 30 });
  assert.deepEqual(t.trialFor(null), { tier: 'standard', days: 30 });
  assert.deepEqual(t.trialFor({ id: 'x' }), { tier: 'extended', days: 90 });
});

test('normalizeSelection: emails, domains, bad input', () => {
  assert.deepEqual(t.normalizeSelection(' HR@Acme.com '), { ok: true, match: 'hr@acme.com', kind: 'email' });
  assert.deepEqual(t.normalizeSelection('acme.com'), { ok: true, match: '@acme.com', kind: 'domain' });
  assert.deepEqual(t.normalizeSelection('@Acme.co.in'), { ok: true, match: '@acme.co.in', kind: 'domain' });
  for (const bad of ['', '   ', 'acme', 'a b@acme.com', 'x@@acme.com', '@']) {
    assert.equal(t.normalizeSelection(bad).ok, false, bad);
  }
});

test('normalizeSelection: public mail domains cannot be selected as a domain, but exact emails can', () => {
  assert.equal(t.normalizeSelection('gmail.com').ok, false);
  assert.equal(t.normalizeSelection('@outlook.com').ok, false);
  assert.equal(t.normalizeSelection('owner@gmail.com').ok, true);
});

test('matchKeys: exact address first, then domain; no domain for public mail', () => {
  assert.deepEqual(t.matchKeys('Hr@Acme.com'), ['hr@acme.com', '@acme.com']);
  assert.deepEqual(t.matchKeys('someone@gmail.com'), ['someone@gmail.com']);
  assert.deepEqual(t.matchKeys('nonsense'), []);
});

test('extendedEnd / standardEnd', () => {
  const created = new Date('2026-10-01T00:00:00Z');
  const now = new Date('2026-10-20T00:00:00Z');
  assert.equal(t.extendedEnd(created, 'signup', now).toISOString(), '2026-12-30T00:00:00.000Z');
  assert.equal(t.extendedEnd(created, 'today', now).toISOString(), '2027-01-18T00:00:00.000Z');
  assert.equal(t.standardEnd(created).toISOString(), '2026-10-31T00:00:00.000Z');
});
