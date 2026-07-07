/**
 * Credits Utility
 *
 * checkAndDeductCredits — the single entry point for any action that costs credits.
 * Call this BEFORE performing the action. If insufficient balance, throws AppError.
 *
 * Flow:
 *   1. Look up the cost in credit_cost table (moduleKey + actionKey)
 *   2. Check credit_account.balance >= cost
 *   3. Run a DB transaction:
 *      a. Update credit_account.balance -= cost
 *      b. Insert credit_transaction (type='spent')
 *   4. Return the transaction record
 *
 * On action failure, call refundCredits() to reverse the deduction.
 */

const { db, schema } = require('./db');
const { eq, and, sql } = require('drizzle-orm');
const { AppError } = require('./errors');

/**
 * @param {string} orgId
 * @param {string} actorId
 * @param {string} moduleKey    e.g. 'candidate_db'
 * @param {string} actionKey    e.g. 'resume_parse'
 * @param {string} entityId     UUID of the entity the action is performed on
 * @param {string} entityType   e.g. 'candidate' | 'application'
 * @returns {Promise<object>}   The inserted credit_transaction row
 */
async function checkAndDeductCredits(orgId, actorId, moduleKey, actionKey, entityId, entityType) {
  // 1. Find the cost definition
  const cost = await db.query.creditCost.findFirst({
    where: and(
      eq(schema.creditCost.moduleKey, moduleKey),
      eq(schema.creditCost.actionKey, actionKey),
      eq(schema.creditCost.active, true)
    ),
  });

  if (!cost) {
    throw new AppError(`No credit cost defined for ${moduleKey}.${actionKey}`, 500);
  }

  // 2. Find the org's credit account
  const account = await db.query.creditAccount.findFirst({
    where: eq(schema.creditAccount.organisationId, orgId),
  });

  if (!account) {
    throw new AppError('Credit account not found for this organisation', 500);
  }

  if (account.balance < cost.cost) {
    throw new AppError(
      `Insufficient credits. Required: ${cost.cost}, available: ${account.balance}`,
      402
    );
  }

  // 3. Deduct in a transaction
  const newBalance = account.balance - cost.cost;
  let transaction;

  await db.transaction(async (tx) => {
    await tx
      .update(schema.creditAccount)
      .set({
        balance: newBalance,
        lifetimeSpent: sql`lifetime_spent + ${cost.cost}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.creditAccount.organisationId, orgId));

    [transaction] = await tx
      .insert(schema.creditTransaction)
      .values({
        organisationId: orgId,
        creditAccountId: account.id,
        actorId,
        type: 'spent',
        amount: cost.cost,
        balanceAfter: newBalance,
        moduleKey,
        actionKey,
        entityId,
        entityType,
        description: cost.description,
      })
      .returning();
  });

  return transaction;
}

/**
 * Refund credits when an action fails after deduction.
 * @param {string} orgId
 * @param {string} actorId
 * @param {number} amount
 * @param {string} moduleKey
 * @param {string} actionKey
 * @param {string} entityId
 * @param {string} entityType
 */
async function refundCredits(orgId, actorId, amount, moduleKey, actionKey, entityId, entityType) {
  await db.transaction(async (tx) => {
    const account = await tx.query.creditAccount.findFirst({
      where: eq(schema.creditAccount.organisationId, orgId),
    });

    const newBalance = account.balance + amount;

    await tx
      .update(schema.creditAccount)
      .set({ balance: newBalance, updatedAt: new Date() })
      .where(eq(schema.creditAccount.organisationId, orgId));

    await tx.insert(schema.creditTransaction).values({
      organisationId: orgId,
      creditAccountId: account.id,
      actorId,
      type: 'refunded',
      amount,
      balanceAfter: newBalance,
      moduleKey,
      actionKey,
      entityId,
      entityType,
      description: 'Refund: action failed',
    });
  });
}

module.exports = { checkAndDeductCredits, refundCredits };
