const test = require('node:test');
const assert = require('node:assert/strict');
const { quotaWindow, resumeParseLimit } = require('../src/utils/quotas');

const DAY = 86400000;
const START = new Date('2026-10-01T00:00:00Z');
const at = (days) => new Date(START.getTime() + days * DAY);

test('quotaWindow: 30-day windows counted from the org start', () => {
  assert.equal(quotaWindow(START, at(0)).index, 0);
  assert.equal(quotaWindow(START, at(29.9)).index, 0);
  assert.equal(quotaWindow(START, at(30)).index, 1);
  assert.equal(quotaWindow(START, at(89.9)).index, 2);
  assert.equal(quotaWindow(START, at(90)).index, 3);
  const w = quotaWindow(START, at(45));
  assert.equal(w.start.getTime(), at(30).getTime());
  assert.equal(w.end.getTime(), at(60).getTime());
});

test('quotaWindow: a 90-day trial is exactly three windows (3 x 500 = 1500)', () => {
  const idxs = new Set();
  for (let d = 0; d < 90; d += 0.5) idxs.add(quotaWindow(START, at(d)).index);
  assert.deepEqual([...idxs], [0, 1, 2]);
});

test('quotaWindow: clock skew before the anchor never goes negative', () => {
  assert.equal(quotaWindow(START, at(-1)).index, 0);
});

test('resumeParseLimit: trial cap while trialing, paid cap after, unlimited when unset', () => {
  const plan = { limits: { trial_resume_parses_per_month: 500, resume_parses_per_month: 5000 } };
  assert.equal(resumeParseLimit({ status: 'trialing' }, plan), 500);
  assert.equal(resumeParseLimit({ status: 'active' }, plan), 5000);
  assert.equal(resumeParseLimit({ status: 'active' }, { limits: { trial_resume_parses_per_month: 500 } }), null);
  assert.equal(resumeParseLimit({ status: 'active' }, { limits: { resume_parses_per_month: -1 } }), null);
  assert.equal(resumeParseLimit({ status: 'trialing' }, { limits: {} }), null);
  assert.equal(resumeParseLimit({ status: 'trialing' }, null), null);
});
