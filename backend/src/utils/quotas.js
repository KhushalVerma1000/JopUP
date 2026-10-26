/**
 * Quotas — free-but-metered allowances (no credits involved).
 *
 * First user: resume parsing. It costs no credits, but a trial may parse at
 * most `trial_resume_parses_per_month` resumes per month (500 on every plan;
 * a 90-day trial therefore allows 1,500). After the trial the paid cap is
 * `resume_parses_per_month` (absent / -1 = unlimited).
 *
 * "Month" = a 30-day window counted from the day the organisation was created,
 * so a 90-day trial is exactly three windows and the allowance cannot drift
 * with calendar month lengths.
 *
 * Reservations are atomic (single upsert that only increments while the new
 * total stays within the cap), so parallel uploads cannot overshoot it.
 */
const { db, schema } = require('./db');
const { and, eq, sql } = require('drizzle-orm');
const { AppError } = require('./errors');
const ent = require('./entitlements');

const WINDOW_DAYS = 30;
const DAY_MS = 86400000;
const RESUME_PARSE = 'resume_parse';

/** Pure: the 30-day window containing `now`, counted from `anchor`. */
function quotaWindow(anchor, now = new Date(), windowDays = WINDOW_DAYS) {
  const a = new Date(anchor).getTime();
  const span = windowDays * DAY_MS;
  const idx = Math.max(0, Math.floor((now.getTime() - a) / span));
  return { index: idx, start: new Date(a + idx * span), end: new Date(a + (idx + 1) * span) };
}

/** Pure: which cap applies to this org right now (null = unlimited). */
function resumeParseLimit(org, plan) {
  const limits = (plan && plan.limits) || {};
  const v = org && org.status === 'trialing' ? limits.trial_resume_parses_per_month : limits.resume_parses_per_month;
  return ent.isUnlimited(v) ? null : v;
}

async function usedIn(orgId, key, periodStart) {
  const [row] = await db.select({ count: schema.usageCounter.count }).from(schema.usageCounter).where(and(
    eq(schema.usageCounter.organisationId, orgId),
    eq(schema.usageCounter.key, key),
    eq(schema.usageCounter.periodStart, periodStart),
  ));
  return row ? row.count : 0;
}

/** @returns {Promise<boolean>} true if `qty` fitted under `limit` and was recorded. */
async function reserve(orgId, key, qty, limit, periodStart) {
  if (qty > limit) return false; // can never fit; also keeps the insert path under the cap
  const rows = await db.insert(schema.usageCounter)
    .values({ organisationId: orgId, key, periodStart, count: qty })
    .onConflictDoUpdate({
      target: [schema.usageCounter.organisationId, schema.usageCounter.key, schema.usageCounter.periodStart],
      set: { count: sql`${schema.usageCounter.count} + ${qty}`, updatedAt: new Date() },
      setWhere: sql`${schema.usageCounter.count} + ${qty} <= ${limit}`,
    })
    .returning({ count: schema.usageCounter.count });
  return rows.length > 0;
}

async function release(orgId, key, qty, periodStart) {
  if (!qty || qty < 1) return;
  await db.update(schema.usageCounter)
    .set({ count: sql`GREATEST(${schema.usageCounter.count} - ${qty}, 0)`, updatedAt: new Date() })
    .where(and(eq(schema.usageCounter.organisationId, orgId), eq(schema.usageCounter.key, key), eq(schema.usageCounter.periodStart, periodStart)));
}

/** Where this org stands on resume parsing this window (used by the billing screen). */
async function resumeParseStatus(orgId, ctx) {
  const c = ctx || await ent.loadOrgContext(orgId);
  const limit = resumeParseLimit(c.org, c.plan);
  const win = quotaWindow(c.org.createdAt);
  const used = await usedIn(orgId, RESUME_PARSE, win.start);
  return { limit, used, remaining: limit === null ? null : Math.max(0, limit - used), windowStart: win.start, resetsAt: win.end };
}

/**
 * Reserve `qty` resume parses for this window. Throws 403 PARSE_QUOTA if they
 * do not all fit (the batch is rejected whole). Returns null when unlimited,
 * otherwise { ...status, release(n) } to hand back parses that did not happen.
 */
async function reserveResumeParses(orgId, qty) {
  const ctx = await ent.loadOrgContext(orgId);
  if (!ctx) return null;
  const limit = resumeParseLimit(ctx.org, ctx.plan);
  if (limit === null) return null;

  const win = quotaWindow(ctx.org.createdAt);
  if (!(await reserve(orgId, RESUME_PARSE, qty, limit, win.start))) {
    const used = await usedIn(orgId, RESUME_PARSE, win.start);
    const remaining = Math.max(0, limit - used);
    const when = win.end.toISOString().slice(0, 10);
    const who = ctx.org.status === 'trialing' ? 'Your trial includes' : 'Your plan includes';
    throw new AppError(
      `${who} ${limit} resume parses per month and ${remaining} ${remaining === 1 ? 'is' : 'are'} left until it resets on ${when}. This upload has ${qty}.`,
      403,
      { code: 'PARSE_QUOTA', limit, used, remaining, requested: qty, resetsAt: win.end },
    );
  }
  return { limit, windowStart: win.start, resetsAt: win.end, release: (n) => release(orgId, RESUME_PARSE, n, win.start) };
}

module.exports = { WINDOW_DAYS, quotaWindow, resumeParseLimit, reserveResumeParses, resumeParseStatus, usedIn };
