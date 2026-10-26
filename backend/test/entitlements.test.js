const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const ent = require('../src/utils/entitlements');
const requireLimit = require('../src/middlewares/requireLimit');
const writeGuard = require('../src/middlewares/writeGuard');
const { totalCost } = require('../src/utils/credits');

const NOW = new Date('2026-10-26T10:00:00Z');
const days = (n) => new Date(NOW.getTime() + n * 86400000);
const run = (mw, req) => new Promise((resolve) => mw(req, {}, (err) => resolve(err || null)));

test('checkLimit: under, at and over the cap', () => {
  assert.equal(ent.checkLimit(5, 3, 1).ok, true);
  assert.equal(ent.checkLimit(5, 5, 1).ok, false);
  assert.equal(ent.checkLimit(5, 4, 2).ok, false);
  assert.equal(ent.checkLimit(5, 4, 2).remaining, 1);
  assert.equal(ent.checkLimit(5, 9, 1).remaining, 0);
});

test('checkLimit: -1, null and undefined mean unlimited', () => {
  for (const v of [-1, null, undefined]) {
    const r = ent.checkLimit(v, 1e9, 1e9);
    assert.equal(r.ok, true);
    assert.equal(r.unlimited, true);
  }
});

test('trialState: counts days, expires exactly at the end, ignores non-trial orgs', () => {
  assert.deepEqual(ent.trialState({ status: 'trialing', trialEndsAt: days(3) }, NOW), { ended: false, daysLeft: 3 });
  assert.equal(ent.trialState({ status: 'trialing', trialEndsAt: days(0.2) }, NOW).daysLeft, 1);
  assert.equal(ent.trialState({ status: 'trialing', trialEndsAt: NOW }, NOW).ended, true);
  assert.equal(ent.trialState({ status: 'trialing', trialEndsAt: days(-1) }, NOW).ended, true);
  assert.equal(ent.trialState({ status: 'active', trialEndsAt: days(-30) }, NOW).ended, false);
  assert.equal(ent.trialState({ status: 'trialing', trialEndsAt: null }, NOW).ended, false);
});

test('writeBlock: expired trial and inactive orgs are read-only; paid orgs are not', () => {
  assert.equal(ent.writeBlock({ status: 'trialing', trialEndsAt: days(2) }, NOW), null);
  assert.equal(ent.writeBlock({ status: 'active', trialEndsAt: days(-5) }, NOW), null);
  assert.equal(ent.writeBlock({ status: 'trialing', trialEndsAt: days(-1) }, NOW).code, 'TRIAL_EXPIRED');
  assert.equal(ent.writeBlock({ status: 'suspended' }, NOW).code, 'ORG_INACTIVE');
  assert.equal(ent.writeBlock({ status: 'cancelled' }, NOW).code, 'ORG_INACTIVE');
});

test('totalCost: multiplies, floors qty, rejects nonsense', () => {
  assert.equal(totalCost(3, 4), 12);
  assert.equal(totalCost(1, 2.9), 2);
  assert.equal(totalCost(5, 0), 0);
  assert.equal(totalCost(5, -2), 0);
  assert.equal(totalCost(5, 'x'), 0);
});

// ── middleware, with the DB reads stubbed ───────────────────────

function stub(ctx, counts = {}) {
  const orig = { load: ent.loadOrgContext, counts: {} };
  ent.loadOrgContext = async () => ctx;
  for (const k of Object.keys(counts)) { orig.counts[k] = ent.LIMITS[k].count; ent.LIMITS[k].count = async () => counts[k]; }
  return () => { ent.loadOrgContext = orig.load; for (const k of Object.keys(orig.counts)) ent.LIMITS[k].count = orig.counts[k]; };
}
const ctxWith = (limits, org = { status: 'trialing', trialEndsAt: days(5) }) => ({ org, plan: { name: 'Starter', limits, creditsEnabled: true } });

test('requireLimit: allows under the cap, blocks at it with a 403 + data', async () => {
  const restore = stub(ctxWith({ max_clients: 3 }), { max_clients: 2 });
  try {
    assert.equal(await run(requireLimit('max_clients'), { tenantId: 'o1' }), null);
  } finally { restore(); }
  const restore2 = stub(ctxWith({ max_clients: 3 }), { max_clients: 3 });
  try {
    const err = await run(requireLimit('max_clients'), { tenantId: 'o1' });
    assert.equal(err.statusCode, 403);
    assert.equal(err.data.code, 'PLAN_LIMIT');
    assert.equal(err.data.limit, 3);
    assert.match(err.message, /clients limit \(3\)/);
  } finally { restore2(); }
});

test('requireLimit: a batch that does not fit is rejected whole and says how many fit', async () => {
  const restore = stub(ctxWith({ max_candidates: 500 }), { max_candidates: 470 });
  try {
    const mw = requireLimit('max_candidates', (req) => req.body.items.length);
    const err = await run(mw, { tenantId: 'o1', body: { items: new Array(40).fill({}) } });
    assert.equal(err.statusCode, 403);
    assert.equal(err.data.remaining, 30);
    assert.equal(err.data.requested, 40);
    assert.match(err.message, /room for 30 more candidates/);
    assert.equal(await run(mw, { tenantId: 'o1', body: { items: new Array(30).fill({}) } }), null);
  } finally { restore(); }
});

test('requireLimit: unlimited plans skip the count entirely', async () => {
  let counted = false;
  const restore = stub(ctxWith({ max_teams: -1 }));
  const orig = ent.LIMITS.max_teams.count;
  ent.LIMITS.max_teams.count = async () => { counted = true; return 999; };
  try {
    assert.equal(await run(requireLimit('max_teams'), { tenantId: 'o1' }), null);
    assert.equal(counted, false);
  } finally { ent.LIMITS.max_teams.count = orig; restore(); }
});

test('requireLimit: unknown key is a server error, not a silent pass', async () => {
  const err = await run(requireLimit('max_nothing'), { tenantId: 'o1' });
  assert.equal(err.statusCode, 500);
});

const tokenFor = (organisationId) => jwt.sign({ userId: 'u1', organisationId, roles: [] }, process.env.JWT_SECRET || 'dev-secret-change-me');
const guardReq = (method, url, organisationId) => ({
  method, originalUrl: url,
  headers: organisationId ? { authorization: `Bearer ${tokenFor(organisationId)}` } : {},
});

test('writeGuard: expired trial blocks writes with 402 but lets reads through', async () => {
  const restore = stub(ctxWith({}, { status: 'trialing', trialEndsAt: days(-1) }));
  try {
    const err = await run(writeGuard, guardReq('POST', '/api/v1/clients', 'o1'));
    assert.equal(err.statusCode, 402);
    assert.equal(err.data.code, 'TRIAL_EXPIRED');
    assert.equal(await run(writeGuard, guardReq('GET', '/api/v1/clients', 'o1')), null);
  } finally { restore(); }
});

test('writeGuard: exempt paths, missing/bad tokens and paid orgs pass through', async () => {
  const restore = stub(ctxWith({}, { status: 'trialing', trialEndsAt: days(-1) }));
  try {
    for (const url of ['/api/v1/auth/login', '/api/v1/credits/top-up', '/api/v1/billing/usage', '/api/v1/platform/orgs', '/api/v1/portal/apply']) {
      assert.equal(await run(writeGuard, guardReq('POST', url, 'o1')), null, url);
    }
    assert.equal(await run(writeGuard, guardReq('POST', '/api/v1/clients', null)), null);
    assert.equal(await run(writeGuard, { method: 'POST', originalUrl: '/api/v1/clients', headers: { authorization: 'Bearer junk' } }), null);
  } finally { restore(); }
  const restore2 = stub(ctxWith({}, { status: 'active', trialEndsAt: days(-30) }));
  try { assert.equal(await run(writeGuard, guardReq('POST', '/api/v1/clients', 'o1')), null); }
  finally { restore2(); }
});

test('writeGuard: suspended workspace is blocked too', async () => {
  const restore = stub(ctxWith({}, { status: 'suspended' }));
  try { assert.equal((await run(writeGuard, guardReq('PATCH', '/api/v1/teams/x', 'o1'))).data.code, 'ORG_INACTIVE'); }
  finally { restore(); }
});

test('app: billing usage needs sign-in; unauthenticated writes still get 401, not 402', async () => {
  assert.equal((await request(app).get('/api/v1/billing/usage')).status, 401);
  assert.equal((await request(app).post('/api/v1/clients').send({})).status, 401);
});

test('writeGuard: fails open when the org lookup errors (permission checks still answer)', async () => {
  const orig = ent.loadOrgContext;
  ent.loadOrgContext = async () => { throw new Error('db down'); };
  const prev = process.env.NODE_ENV; process.env.NODE_ENV = 'test';
  try { assert.equal(await run(writeGuard, guardReq('POST', '/api/v1/clients', 'o1')), null); }
  finally { ent.loadOrgContext = orig; process.env.NODE_ENV = prev; }
});
