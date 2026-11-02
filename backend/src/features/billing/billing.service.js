const { db, schema } = require('../../utils/db');
const { eq } = require('drizzle-orm');
const { NotFoundError } = require('../../utils/errors');
const ent = require('../../utils/entitlements');
const quotas = require('../../utils/quotas');

/**
 * Everything the "Plan & usage" screen needs in one call: plan, trial
 * countdown, usage against each limit, and the credit balance.
 */
async function getUsage(orgId) {
  const ctx = await ent.loadOrgContext(orgId, { fresh: true });
  if (!ctx) throw new NotFoundError('Organisation not found');
  const { org, plan } = ctx;

  const trial = ent.trialState(org);
  const { modules, preview, locked } = ent.resolveModules(ctx);
  const block = ent.writeBlock(org);
  const [account] = await db.select().from(schema.creditAccount).where(eq(schema.creditAccount.organisationId, orgId));

  return {
    organisation: { id: org.id, name: org.name, status: org.status },
    plan: plan && { name: plan.name, slug: plan.slug, priceMonthly: plan.priceMonthly, creditsEnabled: plan.creditsEnabled },
    // What this workspace can open right now, and what a trial preview adds or has taken away.
    modules: {
      enabled: modules,
      locked,
      preview: {
        configured: preview.configured,
        active: preview.active,
        daysLeft: preview.daysLeft,
        endsAt: preview.endsAt,
        planSlug: preview.planSlug,
        planName: ctx.previewPlan ? ctx.previewPlan.name : null,
      },
    },
    trial: { active: org.status === 'trialing' && !trial.ended, ended: trial.ended, endsAt: org.trialEndsAt, daysLeft: trial.daysLeft },
    readOnly: Boolean(block),
    readOnlyReason: block ? block.code : null,
    limits: await ent.usageFor(orgId, ctx),
    resumeParses: await quotas.resumeParseStatus(orgId, ctx),
    credits: account
      ? { balance: account.balance, lifetimeEarned: account.lifetimeEarned, lifetimeSpent: account.lifetimeSpent }
      : null,
  };
}

module.exports = { getUsage };
