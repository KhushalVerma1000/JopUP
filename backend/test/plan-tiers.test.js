const test = require('node:test');
const assert = require('node:assert/strict');
const ent = require('../src/utils/entitlements');
const requireModule = require('../src/middlewares/requireModule');
const trial = require('../src/utils/trial');
const { createRequestSchema } = require('../src/features/trial-requests/trial-requests.schema');
const mail = require('../src/features/trial-requests/trial-requests.mail');
const { approveRequestSchema } = require('../src/features/platform/platform.schema');

const SIGNUP = new Date('2026-11-02T00:00:00Z');
const at = (n) => new Date(SIGNUP.getTime() + n * 86400000);
const BASE = ['client_management', 'candidate_db', 'pipeline_tracker'];
const PRO_ONLY = ['kpi_engine', 'strategy_planner'];

const starter = {
  name: 'Starter', modules: BASE,
  limits: { trial_preview_days: 14, trial_preview_plan: 'pro', trial_credits: 50 },
};
const pro = { name: 'Pro', slug: 'pro', modules: [...BASE, ...PRO_ONLY] };
const org = (over = {}) => ({ status: 'trialing', createdAt: SIGNUP, trialEndsAt: at(30), ...over });

// ── preview window ─────────────────────────────────────────────

test('previewState: active for 14 days from signup, counts days left, then off', () => {
  assert.deepEqual(
    (({ configured, active, daysLeft, planSlug }) => ({ configured, active, daysLeft, planSlug }))(ent.previewState(org(), starter, at(0))),
    { configured: true, active: true, daysLeft: 14, planSlug: 'pro' });
  assert.equal(ent.previewState(org(), starter, at(13.5)).daysLeft, 1);
  const over = ent.previewState(org(), starter, at(14));
  assert.equal(over.active, false);
  assert.equal(over.configured, true);
  assert.equal(over.daysLeft, 0);
});

test('previewState: not configured without plan config, and never for a paid workspace', () => {
  assert.equal(ent.previewState(org(), { limits: {} }, at(1)).configured, false);
  assert.equal(ent.previewState(org(), { limits: { trial_preview_days: 0, trial_preview_plan: 'pro' } }, at(1)).configured, false);
  assert.equal(ent.previewState(org({ status: 'active' }), starter, at(1)).configured, false);
  assert.equal(ent.previewState(null, starter, at(1)).configured, false);
});

test('previewState: a trial that has already ended gets no preview even inside the window', () => {
  assert.equal(ent.previewState(org({ trialEndsAt: at(5) }), starter, at(6)).active, false);
});

// ── module resolution ──────────────────────────────────────────

test('resolveModules: Pro modules appear during the preview, then lock', () => {
  const ctx = { org: org(), plan: starter, overrides: [], previewPlan: pro };
  const during = ent.resolveModules(ctx, at(3));
  assert.ok(PRO_ONLY.every((m) => during.modules.includes(m)));
  assert.deepEqual(during.locked, []);

  const after = ent.resolveModules(ctx, at(20));
  assert.ok(PRO_ONLY.every((m) => !after.modules.includes(m)));
  assert.deepEqual(after.locked.sort(), PRO_ONLY.slice().sort());
  assert.ok(BASE.every((m) => after.modules.includes(m)), 'Starter modules never lock');
});

test('resolveModules: an explicit admin override still wins over the preview', () => {
  const off = ent.resolveModules({ org: org(), plan: starter, previewPlan: pro, overrides: [{ moduleKey: 'kpi_engine', enabled: false }] }, at(3));
  assert.equal(off.modules.includes('kpi_engine'), false);
  const on = ent.resolveModules({ org: org(), plan: starter, previewPlan: pro, overrides: [{ moduleKey: 'kpi_engine', enabled: true }] }, at(20));
  assert.equal(on.modules.includes('kpi_engine'), true);
});

test('resolveModules: an Enterprise or paid workspace is untouched by preview rules', () => {
  const ent1 = ent.resolveModules({ org: org(), plan: { modules: [...BASE, ...PRO_ONLY, 'ai_screening'], limits: {} }, overrides: [], previewPlan: null }, at(40));
  assert.ok(ent1.modules.includes('ai_screening'));
  assert.deepEqual(ent1.locked, []);
});

// ── the gate itself ────────────────────────────────────────────

const run = (mw, req) => new Promise((resolve) => mw(req, {}, (err) => resolve(err || null)));
function stubCtx(ctx) {
  const orig = ent.loadOrgContext;
  ent.loadOrgContext = async () => ctx;
  return () => { ent.loadOrgContext = orig; };
}

test('requireModule: preview open lets a Pro module through; closed returns MODULE_LOCKED with a code', async () => {
  const realNow = Date.now;
  const ctx = { org: org({ createdAt: new Date() , trialEndsAt: new Date(Date.now() + 30 * 86400000) }), plan: starter, overrides: [], previewPlan: pro };
  const restore = stubCtx(ctx);
  try {
    const req = { tenantId: 'o1' };
    assert.equal(await run(requireModule('kpi_engine'), req), null);
    assert.ok(req.enabledModules.includes('kpi_engine'));

    ctx.org = org({ createdAt: new Date(Date.now() - 20 * 86400000), trialEndsAt: new Date(Date.now() + 10 * 86400000) });
    const err = await run(requireModule('kpi_engine'), { tenantId: 'o1' });
    assert.equal(err.statusCode, 403);
    assert.equal(err.data.code, 'MODULE_LOCKED');
    assert.equal(err.data.previewPlan, 'pro');
    assert.match(err.message, /Pro plan/);
  } finally { restore(); Date.now = realNow; }
});

test('requireModule: a module outside any preview keeps the original message, with a plan code', async () => {
  const restore = stubCtx({ org: org(), plan: starter, overrides: [], previewPlan: pro });
  try {
    const err = await run(requireModule('ai_screening'), { tenantId: 'o1' });
    assert.equal(err.statusCode, 403);
    assert.equal(err.data.code, 'MODULE_NOT_IN_PLAN');
    assert.match(err.message, /not enabled for your subscription plan/);
  } finally { restore(); }
});

test('requireModule: missing tenant is a server error; unknown org is forbidden', async () => {
  assert.equal((await run(requireModule('kpi_engine'), {})).statusCode, 500);
  const restore = stubCtx(null);
  try { assert.equal((await run(requireModule('kpi_engine'), { tenantId: 'x' })).statusCode, 403); } finally { restore(); }
});

// ── trial rules ────────────────────────────────────────────────

test('trialCreditsFor: plan taste wins, otherwise the allowance, never negative or fractional', () => {
  assert.equal(trial.trialCreditsFor({ limits: { trial_credits: 50 }, creditAllowance: 100 }), 50);
  assert.equal(trial.trialCreditsFor({ limits: { trial_credits: 0 }, creditAllowance: 100 }), 0);
  assert.equal(trial.trialCreditsFor({ limits: {}, creditAllowance: 100 }), 100);
  assert.equal(trial.trialCreditsFor({ limits: { trial_credits: -5 }, creditAllowance: 100 }), 100);
  assert.equal(trial.trialCreditsFor({ limits: { trial_credits: 7.9 } }), 7);
  assert.equal(trial.trialCreditsFor(null), 0);
  assert.equal(trial.DEFAULT_TRIAL_PLAN_SLUG, 'starter');
});

// ── request form ───────────────────────────────────────────────

const good = { name: 'Asha Rao', email: 'asha@acme.com', company: 'Acme Staffing' };

test('plan request form: defaults to enterprise, trims, drops empty optionals, rejects bad input', () => {
  const ok = createRequestSchema.safeParse({ body: { ...good, name: '  Asha Rao ', phone: '', message: '' } });
  assert.equal(ok.success, true);
  assert.equal(ok.data.body.plan, 'enterprise');
  assert.equal(ok.data.body.name, 'Asha Rao');
  assert.equal(ok.data.body.phone, undefined);
  assert.equal(createRequestSchema.safeParse({ body: { ...good, plan: 'starter' } }).success, false);
  assert.equal(createRequestSchema.safeParse({ body: { ...good, email: 'nope' } }).success, false);
  assert.equal(createRequestSchema.safeParse({ body: { ...good, company: 'A' } }).success, false);
  assert.equal(createRequestSchema.safeParse({ body: { ...good, message: 'x'.repeat(1001) } }).success, false);
});

test('plan request emails: user text is escaped, reply goes to the requester', () => {
  const r = { requestedPlan: 'enterprise', name: 'Eve <script>', email: 'eve@x.com', company: 'X & "Y"', message: '<img src=x onerror=1>' };
  const m = mail.salesMail(r);
  assert.equal(m.replyTo, 'eve@x.com');
  assert.ok(!m.html.includes('<script>') && !m.html.includes('<img'));
  assert.ok(m.html.includes('X &amp; &quot;Y&quot;'));
  assert.match(m.subject, /^Enterprise trial request: /);
  assert.match(mail.salesMail({ ...r, requestedPlan: 'pro' }).subject, /^Pro upgrade request: /);
  assert.ok(!mail.acknowledgement(r).html.includes('<script>'));
});

test('approve request: days default to 30 and stay between 7 and 90', () => {
  const id = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  assert.equal(approveRequestSchema.parse({ params: { id }, body: {} }).body.days, 30);
  assert.equal(approveRequestSchema.parse({ params: { id } }).body.days, 30);
  assert.equal(approveRequestSchema.safeParse({ params: { id }, body: { days: 6 } }).success, false);
  assert.equal(approveRequestSchema.safeParse({ params: { id }, body: { days: 91 } }).success, false);
  assert.equal(approveRequestSchema.safeParse({ params: { id }, body: { days: '45' } }).success, true);
});

// ── the public form must reach its route without a sign-in ─────

test('POST /api/v1/trial-requests: anonymous callers reach validation (400), not the tenant wall (401)', async () => {
  const request = require('supertest');
  const app = require('../src/app');
  const res = await request(app).post('/api/v1/trial-requests').send({ name: 'A', email: 'x' });
  assert.equal(res.status, 400);
});

test('platform request routes need sign-in', async () => {
  const request = require('supertest');
  const app = require('../src/app');
  assert.equal((await request(app).get('/api/v1/platform/trial-requests')).status, 401);
  assert.equal((await request(app).post('/api/v1/platform/trial-requests/3fa85f64-5717-4562-b3fc-2c963f66afa6/approve').send({})).status, 401);
});
