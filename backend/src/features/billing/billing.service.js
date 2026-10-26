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
  const block = ent.writeBlock(org);
  const [account] = await db.select().from(schema.creditAccount).where(eq(schema.creditAccount.organisationId, orgId));

  return {
    organisation: { id: org.id, name: org.name, status: org.status },
    plan: plan && { name: plan.name, slug: plan.slug, priceMonthly: plan.priceMonthly, creditsEnabled: plan.creditsEnabled },
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
