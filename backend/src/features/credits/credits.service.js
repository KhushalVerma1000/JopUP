const { db, schema } = require('../../utils/db');
const { eq, and, desc, sql } = require('drizzle-orm');
const { NotFoundError } = require('../../utils/errors');
const { auditWrite } = require('../../utils/audit');

class CreditsService {
  async getBalance(orgId) {
    const account = await db.query.creditAccount.findFirst({
      where: eq(schema.creditAccount.organisationId, orgId)
    });
    
    if (!account) throw new NotFoundError('Credit account not found');
    
    return account;
  }

  async getTransactions(orgId, filters = {}) {
    const { type, limit = 20, offset = 0 } = filters;
    
    const conditions = [eq(schema.creditTransaction.organisationId, orgId)];
    if (type) conditions.push(eq(schema.creditTransaction.type, type));
    
    return await db.select()
      .from(schema.creditTransaction)
      .where(and(...conditions))
      .orderBy(desc(schema.creditTransaction.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async topUp(orgId, amount, actorId, description) {
    return await db.transaction(async (tx) => {
      const account = await tx.query.creditAccount.findFirst({
        where: eq(schema.creditAccount.organisationId, orgId)
      });
      
      if (!account) throw new NotFoundError('Credit account not found');
      
      const newBalance = account.balance + amount;
      const newEarned = account.lifetimeEarned + amount;
      
      await tx.update(schema.creditAccount)
        .set({ balance: newBalance, lifetimeEarned: newEarned, updatedAt: new Date() })
        .where(eq(schema.creditAccount.id, account.id));
        
      const [transaction] = await tx.insert(schema.creditTransaction).values({
        organisationId: orgId,
        creditAccountId: account.id,
        actorId,
        type: 'topped_up',
        amount,
        balanceAfter: newBalance,
        description: description || 'Manual top up'
      }).returning();
      
      await auditWrite(orgId, actorId, 'top_up', 'credit_account', account.id, account, { ...account, balance: newBalance }, 'credits');
      
      return transaction;
    });
  }

  async adjustCredits(orgId, amount, actorId, description) {
    return await db.transaction(async (tx) => {
      const account = await tx.query.creditAccount.findFirst({
        where: eq(schema.creditAccount.organisationId, orgId)
      });
      
      if (!account) throw new NotFoundError('Credit account not found');
      
      const newBalance = account.balance + amount;
      
      const updateData = { balance: newBalance, updatedAt: new Date() };
      if (amount > 0) updateData.lifetimeEarned = account.lifetimeEarned + amount;
      if (amount < 0) updateData.lifetimeSpent = account.lifetimeSpent + Math.abs(amount);
      
      await tx.update(schema.creditAccount)
        .set(updateData)
        .where(eq(schema.creditAccount.id, account.id));
        
      const [transaction] = await tx.insert(schema.creditTransaction).values({
        organisationId: orgId,
        creditAccountId: account.id,
        actorId,
        type: 'adjusted',
        amount,
        balanceAfter: newBalance,
        description
      }).returning();
      
      await auditWrite(orgId, actorId, 'adjust', 'credit_account', account.id, account, { ...account, balance: newBalance }, 'credits');
      
      return transaction;
    });
  }

  async getCosts() {
    return await db.select().from(schema.creditCost).where(eq(schema.creditCost.active, true));
  }
}

module.exports = new CreditsService();
