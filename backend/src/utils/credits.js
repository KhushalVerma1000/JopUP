/**
 * Credits Utility
 *
 * spendCredits — the single entry point for any action that costs credits.
 * Call BEFORE the action; call refundCredits for any part that then fails.
 *
 * Rules:
 *   - The price comes from credit_cost (module_key + action_key). No active
 *     price row = the action is free (the table is the source of truth).
 *   - Plans with credits_enabled = false are never charged.
 *   - The balance check and the deduction are ONE atomic UPDATE
 *     (... WHERE balance >= total), so parallel requests cannot overdraw.
 *   - qty lets a batch be charged in a single ledger row (e.g. 40 imports).
 *
 * Plain selects only: the relational query API (db.query.*) is avoided on
 * purpose — it crashes in this codebase (see requireModule.js).
 */
const { db, schema } = require('./db');
const { eq, and, gte, sql } = require('drizzle-orm');
const { AppError } = require('./errors');
const ent = require('./entitlements');

/** Pure: total price for qty units of an action. */
function totalCost(unitCost, qty = 1) {
  const q = Math.floor(Number(qty));
  if (!Number.isFinite(q) || q < 1) return 0;
  return unitCost * q;
}

/**
 * @param {string} orgId
 * @param {string} actorId
 * @param {string} moduleKey  e.g. 'candidate_db'
 * @param {string} actionKey  e.g. 'bulk_import'
 * @param {{qty?:number, entityId?:string, entityType?:string}} [opts]
 * @returns {Promise<null | {transaction:object, amount:number, balance:number}>}  null = nothing charged
 */
async function spendCredits(orgId, actorId, moduleKey, actionKey, opts = {}) {
  const { qty = 1, entityId = null, entityType = null } = opts;

  const ctx = await ent.loadOrgContext(orgId);
  if (ctx && ctx.plan && !ctx.plan.creditsEnabled) return null;

  const [cost] = await db.select().from(schema.creditCost).where(and(
    eq(schema.creditCost.moduleKey, moduleKey),
    eq(schema.creditCost.actionKey, actionKey),
    eq(schema.creditCost.active, true),
  ));
  if (!cost) return null;

  const total = totalCost(cost.cost, qty);
  if (total === 0) return null;

  return db.transaction(async (tx) => {
    const [account] = await tx.update(schema.creditAccount)
      .set({
        balance: sql`${schema.creditAccount.balance} - ${total}`,
        lifetimeSpent: sql`${schema.creditAccount.lifetimeSpent} + ${total}`,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.creditAccount.organisationId, orgId), gte(schema.creditAccount.balance, total)))
      .returning();

    if (!account) {
      const [current] = await tx.select().from(schema.creditAccount).where(eq(schema.creditAccount.organisationId, orgId));
      if (!current) throw new AppError('Credit account not found for this organisation', 500);
      throw new AppError(
        `Not enough credits. This needs ${total}, you have ${current.balance}.`,
        402,
        { code: 'INSUFFICIENT_CREDITS', required: total, available: current.balance },
      );
    }

    const [transaction] = await tx.insert(schema.creditTransaction).values({
      organisationId: orgId,
      creditAccountId: account.id,
      actorId,
      type: 'spent',
      amount: total,
      balanceAfter: account.balance,
      moduleKey,
      actionKey,
      entityId,
      entityType,
      description: qty > 1 ? `${cost.description || actionKey} × ${qty}` : cost.description,
    }).returning();

    return { transaction, amount: total, balance: account.balance };
  });
}

/**
 * Give credits back when part of a charged action did not happen.
 * Also lowers lifetime_spent so usage stats stay truthful.
 */
async function refundCredits(orgId, actorId, amount, moduleKey, actionKey, entityId = null, entityType = null, description = 'Refund: action failed') {
  if (!amount || amount < 1) return null;
  return db.transaction(async (tx) => {
    const [account] = await tx.update(schema.creditAccount)
      .set({
        balance: sql`${schema.creditAccount.balance} + ${amount}`,
        lifetimeSpent: sql`GREATEST(${schema.creditAccount.lifetimeSpent} - ${amount}, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(schema.creditAccount.organisationId, orgId))
      .returning();
    if (!account) throw new AppError('Credit account not found for this organisation', 500);

    const [transaction] = await tx.insert(schema.creditTransaction).values({
      organisationId: orgId,
      creditAccountId: account.id,
      actorId,
      type: 'refunded',
      amount,
      balanceAfter: account.balance,
      moduleKey,
      actionKey,
      entityId,
      entityType,
      description,
    }).returning();
    return transaction;
  });
}

// Backwards-compatible name for the original single-unit helper.
const checkAndDeductCredits = (orgId, actorId, moduleKey, actionKey, entityId, entityType) =>
  spendCredits(orgId, actorId, moduleKey, actionKey, { entityId, entityType });

module.exports = { spendCredits, refundCredits, checkAndDeductCredits, totalCost };
