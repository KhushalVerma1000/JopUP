const { sql } = require('drizzle-orm');
const { db, schema } = require('../../utils/db');
const { eq } = require('drizzle-orm');
const { NotFoundError } = require('../../utils/errors');

// The internal org that holds platform_owner / platform_admin identities
// (see scripts/provision-owner.ts). It is not a customer tenant, so it is
// excluded from every customer-facing metric and listing here.
const PLATFORM_ORG_SLUG = process.env.PLATFORM_ORG_SLUG || 'jopup-platform';

const rows = (result) => result.rows ?? result;
const num = (v) => Number(v ?? 0);

class PlatformService {
  /**
   * Headline numbers for the platform-admin dashboard. All counts exclude
   * the internal platform org. MRR is *contracted* (active orgs only) —
   * trialing orgs are reported separately as `trialPipelineMrr` so nobody
   * mistakes trials for revenue. Until the payment module lands this is
   * derived from plan list price, not from real invoices.
   */
  async getMetrics() {
    const [orgStats] = rows(await db.execute(sql`
      SELECT
        count(*)                                             AS total,
        count(*) FILTER (WHERE o.status = 'active')          AS active,
        count(*) FILTER (WHERE o.status = 'trialing')        AS trialing,
        count(*) FILTER (WHERE o.status = 'suspended')       AS suspended,
        count(*) FILTER (WHERE o.status = 'cancelled')       AS cancelled,
        count(*) FILTER (WHERE o.created_at >= now() - interval '30 days') AS new_30d,
        coalesce(sum(p.price_monthly) FILTER (WHERE o.status = 'active'), 0)   AS mrr,
        coalesce(sum(p.price_monthly) FILTER (WHERE o.status = 'trialing'), 0) AS trial_pipeline_mrr
      FROM organisation o
      JOIN plan p ON p.id = o.plan_id
      WHERE o.slug <> ${PLATFORM_ORG_SLUG}
    `));

    const [usage] = rows(await db.execute(sql`
      SELECT
        (SELECT count(*) FROM "user" u JOIN organisation o ON o.id = u.organisation_id
           WHERE o.slug <> ${PLATFORM_ORG_SLUG} AND u.status = 'active')           AS users,
        (SELECT count(*) FROM "user" u JOIN organisation o ON o.id = u.organisation_id
           WHERE o.slug <> ${PLATFORM_ORG_SLUG} AND u.status = 'pending_approval') AS pending_users,
        (SELECT count(*) FROM candidate c JOIN organisation o ON o.id = c.organisation_id
           WHERE o.slug <> ${PLATFORM_ORG_SLUG})                                    AS candidates,
        (SELECT count(*) FROM client c JOIN organisation o ON o.id = c.organisation_id
           WHERE o.slug <> ${PLATFORM_ORG_SLUG})                                    AS clients,
        (SELECT count(*) FROM job_posting j JOIN organisation o ON o.id = j.organisation_id
           WHERE o.slug <> ${PLATFORM_ORG_SLUG} AND j.status = 'published')         AS live_jobs,
        (SELECT count(*) FROM candidate_tracker t JOIN organisation o ON o.id = t.organisation_id
           WHERE o.slug <> ${PLATFORM_ORG_SLUG} AND t.status = 'active')            AS active_trackers
    `));

    const byPlan = rows(await db.execute(sql`
      SELECT p.slug, p.name, count(o.id) AS orgs
      FROM plan p
      LEFT JOIN organisation o ON o.plan_id = p.id AND o.slug <> ${PLATFORM_ORG_SLUG}
      GROUP BY p.id ORDER BY p.price_monthly NULLS FIRST
    `));

    // Last 6 calendar months, zero-filled so the chart has no gaps.
    const signups = rows(await db.execute(sql`
      SELECT to_char(m.month, 'YYYY-MM') AS month, count(o.id) AS orgs
      FROM generate_series(date_trunc('month', now()) - interval '5 months',
                           date_trunc('month', now()), interval '1 month') AS m(month)
      LEFT JOIN organisation o
        ON date_trunc('month', o.created_at) = m.month AND o.slug <> ${PLATFORM_ORG_SLUG}
      GROUP BY m.month ORDER BY m.month
    `));

    const trialsEnding = rows(await db.execute(sql`
      SELECT o.id, o.name, o.slug, o.trial_ends_at, p.name AS plan_name
      FROM organisation o JOIN plan p ON p.id = o.plan_id
      WHERE o.slug <> ${PLATFORM_ORG_SLUG} AND o.status = 'trialing'
        AND o.trial_ends_at IS NOT NULL AND o.trial_ends_at <= now() + interval '7 days'
      ORDER BY o.trial_ends_at LIMIT 8
    `));

    const recent = rows(await db.execute(sql`
      SELECT o.id, o.name, o.slug, o.status, o.created_at, p.name AS plan_name
      FROM organisation o JOIN plan p ON p.id = o.plan_id
      WHERE o.slug <> ${PLATFORM_ORG_SLUG}
      ORDER BY o.created_at DESC LIMIT 6
    `));

    return {
      organisations: {
        total: num(orgStats.total), active: num(orgStats.active), trialing: num(orgStats.trialing),
        suspended: num(orgStats.suspended), cancelled: num(orgStats.cancelled), new30d: num(orgStats.new_30d),
      },
      revenue: { mrr: num(orgStats.mrr), trialPipelineMrr: num(orgStats.trial_pipeline_mrr), currency: 'INR', basis: 'plan_list_price' },
      usage: {
        users: num(usage.users), pendingUsers: num(usage.pending_users), candidates: num(usage.candidates),
        clients: num(usage.clients), liveJobs: num(usage.live_jobs), activeTrackers: num(usage.active_trackers),
      },
      byPlan: byPlan.map((r) => ({ slug: r.slug, name: r.name, orgs: num(r.orgs) })),
      signupsByMonth: signups.map((r) => ({ month: r.month, orgs: num(r.orgs) })),
      trialsEnding: trialsEnding.map((r) => ({ id: r.id, name: r.name, slug: r.slug, trialEndsAt: r.trial_ends_at, planName: r.plan_name })),
      recentSignups: recent.map((r) => ({ id: r.id, name: r.name, slug: r.slug, status: r.status, createdAt: r.created_at, planName: r.plan_name })),
    };
  }

  /** Paginated tenant list with per-org usage counts. */
  async listOrganisations({ search, status, planSlug, limit, offset }) {
    const like = search ? `%${search}%` : null;
    const where = sql`o.slug <> ${PLATFORM_ORG_SLUG}
      ${status ? sql`AND o.status = ${status}` : sql``}
      ${planSlug ? sql`AND p.slug = ${planSlug}` : sql``}
      ${like ? sql`AND (o.name ILIKE ${like} OR o.slug ILIKE ${like})` : sql``}`;

    const [{ total }] = rows(await db.execute(sql`
      SELECT count(*) AS total FROM organisation o JOIN plan p ON p.id = o.plan_id WHERE ${where}`));

    const list = rows(await db.execute(sql`
      SELECT o.id, o.name, o.slug, o.status, o.created_at, o.trial_ends_at, o.default_country,
             p.name AS plan_name, p.slug AS plan_slug,
             (SELECT count(*) FROM "user" u WHERE u.organisation_id = o.id AND u.status = 'active')   AS users,
             (SELECT count(*) FROM team t WHERE t.organisation_id = o.id)                              AS teams,
             (SELECT count(*) FROM candidate c WHERE c.organisation_id = o.id)                         AS candidates,
             (SELECT count(*) FROM client c WHERE c.organisation_id = o.id)                            AS clients,
             (SELECT max(u.last_login_at) FROM "user" u WHERE u.organisation_id = o.id)                AS last_active_at
      FROM organisation o JOIN plan p ON p.id = o.plan_id
      WHERE ${where}
      ORDER BY o.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `));

    return {
      total: num(total),
      organisations: list.map((r) => ({
        id: r.id, name: r.name, slug: r.slug, status: r.status, createdAt: r.created_at,
        trialEndsAt: r.trial_ends_at, defaultCountry: r.default_country,
        plan: { name: r.plan_name, slug: r.plan_slug },
        counts: { users: num(r.users), teams: num(r.teams), candidates: num(r.candidates), clients: num(r.clients) },
        lastActiveAt: r.last_active_at,
      })),
    };
  }

  /** Everything the platform admin needs to look at one tenant. */
  async getOrganisationDetail(id) {
    const [org] = await db.select().from(schema.organisation).where(eq(schema.organisation.id, id));
    if (!org || org.slug === PLATFORM_ORG_SLUG) throw new NotFoundError('Organization not found');

    const [plan] = await db.select().from(schema.plan).where(eq(schema.plan.id, org.planId));

    const [counts] = rows(await db.execute(sql`
      SELECT
        (SELECT count(*) FROM "user" WHERE organisation_id = ${id} AND status = 'active')           AS users,
        (SELECT count(*) FROM "user" WHERE organisation_id = ${id} AND status = 'pending_approval') AS pending_users,
        (SELECT count(*) FROM team WHERE organisation_id = ${id})                                    AS teams,
        (SELECT count(*) FROM candidate WHERE organisation_id = ${id})                               AS candidates,
        (SELECT count(*) FROM client WHERE organisation_id = ${id})                                  AS clients,
        (SELECT count(*) FROM job_posting WHERE organisation_id = ${id} AND status = 'published')    AS live_jobs,
        (SELECT count(*) FROM open_position WHERE organisation_id = ${id} AND status = 'open')       AS open_positions,
        (SELECT count(*) FROM candidate_tracker WHERE organisation_id = ${id} AND status = 'active') AS active_trackers
    `));

    const admins = rows(await db.execute(sql`
      SELECT u.id, u.email, u.first_name, u.last_name, u.status, u.last_login_at
      FROM "user" u
      JOIN user_team_role utr ON utr.user_id = u.id AND utr.revoked_at IS NULL
      JOIN role r ON r.id = utr.role_id AND r.name = 'org_admin'
      WHERE u.organisation_id = ${id}
    `));

    const teams = rows(await db.execute(sql`
      SELECT t.id, t.name,
        (SELECT count(DISTINCT utr.user_id) FROM user_team_role utr
           WHERE utr.team_id = t.id AND utr.revoked_at IS NULL) AS members
      FROM team t WHERE t.organisation_id = ${id} ORDER BY t.name
    `));

    const [sub] = rows(await db.execute(sql`
      SELECT status, billing_cycle, payment_provider, current_period_end, trial_ends_at
      FROM subscription WHERE organisation_id = ${id} ORDER BY created_at DESC LIMIT 1
    `));

    const [credit] = await db.select().from(schema.creditAccount).where(eq(schema.creditAccount.organisationId, id));

    const limits = plan?.limits || {};
    return {
      organisation: {
        id: org.id, name: org.name, slug: org.slug, domain: org.domain, status: org.status,
        timezone: org.timezone, defaultCountry: org.defaultCountry, trialEndsAt: org.trialEndsAt, createdAt: org.createdAt,
      },
      plan: plan && { name: plan.name, slug: plan.slug, priceMonthly: plan.priceMonthly, modules: plan.modules, limits },
      subscription: sub ? {
        status: sub.status, billingCycle: sub.billing_cycle, paymentProvider: sub.payment_provider,
        currentPeriodEnd: sub.current_period_end, trialEndsAt: sub.trial_ends_at,
      } : null,
      credits: credit ? { balance: credit.balance, lifetimeSpent: credit.lifetimeSpent } : null,
      counts: {
        users: num(counts.users), pendingUsers: num(counts.pending_users), teams: num(counts.teams),
        candidates: num(counts.candidates), clients: num(counts.clients), liveJobs: num(counts.live_jobs),
        openPositions: num(counts.open_positions), activeTrackers: num(counts.active_trackers),
      },
      admins: admins.map((a) => ({ id: a.id, email: a.email, name: `${a.first_name} ${a.last_name}`, status: a.status, lastLoginAt: a.last_login_at })),
      teams: teams.map((t) => ({ id: t.id, name: t.name, members: num(t.members) })),
    };
  }
}

module.exports = new PlatformService();
