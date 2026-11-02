/**
 * Entitlements — plan limits and trial state for an organisation.
 *
 * Pure decision helpers (checkLimit, trialState, writeBlock) are kept apart
 * from the DB reads so they can be unit tested without Postgres.
 *
 * Limit values come from plan.limits (jsonb). Missing, null or -1 = unlimited.
 *
 * Trial expiry is DERIVED, not stored: an org is "expired" when its status is
 * 'trialing' and trial_ends_at has passed. No scheduler has to flip a flag, so
 * a stopped worker can never leave an expired trial writable.
 */
const { db, schema } = require('./db');
const { eq, and, ne, notInArray, sql } = require('drizzle-orm');

// ─── Pure helpers ────────────────────────────────────────────

function isUnlimited(limit) {
  return limit === undefined || limit === null || limit === -1;
}

/** @returns {{ok:boolean, unlimited:boolean, limit:number|null, current:number, remaining:number|null}} */
function checkLimit(limit, current, adding = 1) {
  if (isUnlimited(limit)) return { ok: true, unlimited: true, limit: null, current, remaining: null };
  const remaining = Math.max(0, limit - current);
  return { ok: current + adding <= limit, unlimited: false, limit, current, remaining };
}

/** @returns {{ended:boolean, daysLeft:number|null}} */
function trialState(org, now = new Date()) {
  if (!org || org.status !== 'trialing' || !org.trialEndsAt) return { ended: false, daysLeft: null };
  const ms = new Date(org.trialEndsAt).getTime() - now.getTime();
  return { ended: ms <= 0, daysLeft: Math.max(0, Math.ceil(ms / 86400000)) };
}

/** @returns {null | {code:string, message:string}} null = writes allowed */
function writeBlock(org, now = new Date()) {
  if (!org) return null;
  if (org.status === 'suspended' || org.status === 'cancelled') {
    return { code: 'ORG_INACTIVE', message: 'This workspace is not active. Contact support to restore access.' };
  }
  if (trialState(org, now).ended) {
    return { code: 'TRIAL_EXPIRED', message: 'Your trial has ended. Your data is safe and read-only — upgrade to keep making changes.' };
  }
  return null;
}

const DAY_MS = 86400000;

/**
 * The time-boxed "taste" of a higher plan during a trial.
 * Configured on the org's own plan: limits.trial_preview_days and
 * limits.trial_preview_plan (a plan slug, e.g. "pro"). Counted from signup and
 * DERIVED like trial expiry, so no scheduler has to switch it off.
 * @returns {{configured:boolean, active:boolean, daysLeft:number, endsAt:Date|null, planSlug:string|null}}
 */
function previewState(org, plan, now = new Date()) {
  const none = { configured: false, active: false, daysLeft: 0, endsAt: null, planSlug: null };
  const limits = (plan && plan.limits) || {};
  const days = Number(limits.trial_preview_days);
  const slug = limits.trial_preview_plan || null;
  if (!org || org.status !== 'trialing' || !org.createdAt || !slug || !Number.isFinite(days) || days <= 0) return none;
  const endsAt = new Date(new Date(org.createdAt).getTime() + days * DAY_MS);
  const trialOver = org.trialEndsAt && new Date(org.trialEndsAt).getTime() <= now.getTime();
  const ms = endsAt.getTime() - now.getTime();
  const active = ms > 0 && !trialOver;
  return { configured: true, active, daysLeft: active ? Math.ceil(ms / DAY_MS) : 0, endsAt, planSlug: slug };
}

/**
 * Modules this org can use right now: plan modules, plus the preview plan's
 * modules while the preview runs, then per-org overrides (an explicit admin
 * "off" still wins). `locked` = modules the preview plan has that the org
 * cannot use, i.e. what upgrading would add.
 * @param {{org:object, plan:object|null, overrides?:object[], previewPlan?:object|null}} ctx
 */
function resolveModules(ctx, now = new Date()) {
  const set = new Set((ctx.plan && ctx.plan.modules) || []);
  const preview = previewState(ctx.org, ctx.plan, now);
  const previewModules = (ctx.previewPlan && ctx.previewPlan.modules) || [];
  if (preview.active) previewModules.forEach((m) => set.add(m));
  for (const o of ctx.overrides || []) {
    if (o.enabled) set.add(o.moduleKey); else set.delete(o.moduleKey);
  }
  const locked = preview.configured ? previewModules.filter((m) => !set.has(m)) : [];
  return { modules: [...set], preview, locked };
}

// ─── Limit registry ──────────────────────────────────────────

const LIMITS = {
  max_candidates: {
    label: 'candidates',
    count: async (orgId) => countWhere(schema.candidate, eq(schema.candidate.organisationId, orgId)),
  },
  max_clients: {
    label: 'clients',
    count: async (orgId) => countWhere(schema.client, eq(schema.client.organisationId, orgId)),
  },
  max_teams: {
    label: 'teams',
    count: async (orgId) => countWhere(schema.team, and(eq(schema.team.organisationId, orgId), ne(schema.team.status, 'archived'))),
  },
  max_job_postings: {
    label: 'job postings',
    // Closed/archived postings no longer count against the cap.
    count: async (orgId) => countWhere(schema.jobPosting, and(
      eq(schema.jobPosting.organisationId, orgId),
      notInArray(schema.jobPosting.status, ['closed', 'archived']),
    )),
  },
};

async function countWhere(table, where) {
  const [row] = await db.select({ n: sql`count(*)::int` }).from(table).where(where);
  return row ? Number(row.n) : 0;
}

// ─── DB reads ────────────────────────────────────────────────

const CACHE_TTL_MS = 10 * 1000;
const cache = new Map();

async function loadOrgContext(orgId, { fresh = false } = {}) {
  const hit = cache.get(orgId);
  if (!fresh && hit && hit.expires > Date.now()) return hit.value;
  const [org] = await db.select().from(schema.organisation).where(eq(schema.organisation.id, orgId));
  if (!org) return null;
  const [plan] = await db.select().from(schema.plan).where(eq(schema.plan.id, org.planId));
  const overrides = await db.select().from(schema.orgModuleOverride).where(eq(schema.orgModuleOverride.organisationId, orgId));
  let previewPlan = null;
  const previewSlug = plan && plan.limits && plan.limits.trial_preview_plan;
  if (previewSlug && org.status === 'trialing') {
    [previewPlan] = await db.select().from(schema.plan).where(eq(schema.plan.slug, previewSlug));
  }
  const value = { org, plan: plan || null, overrides, previewPlan: previewPlan || null };
  cache.set(orgId, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

function clearCache(orgId) { orgId ? cache.delete(orgId) : cache.clear(); }

async function usageFor(orgId, ctx) {
  const limits = (ctx.plan && ctx.plan.limits) || {};
  const out = {};
  for (const [key, def] of Object.entries(LIMITS)) {
    const current = await def.count(orgId);
    out[key] = { label: def.label, ...checkLimit(limits[key], current, 0) };
  }
  return out;
}

module.exports = { isUnlimited, checkLimit, trialState, writeBlock, previewState, resolveModules, LIMITS, loadOrgContext, clearCache, usageFor };
