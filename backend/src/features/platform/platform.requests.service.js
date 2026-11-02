/**
 * Platform side of plan requests: list them, switch a workspace onto an
 * Enterprise trial, or close a request. Kept apart from platform.service.js,
 * which is already large.
 */
const { sql } = require('drizzle-orm');
const { db, schema } = require('../../utils/db');
const { eq, and } = require('drizzle-orm');
const { NotFoundError, BadRequestError, ConflictError } = require('../../utils/errors');
const trialRules = require('../../utils/trial');
const { auditWrite } = require('../../utils/audit');
const ent = require('../../utils/entitlements');
const mail = require('../trial-requests/trial-requests.mail');
const { workspacesForEmails, trySend } = require('../trial-requests/trial-requests.service');

const PLATFORM_ORG_SLUG = process.env.PLATFORM_ORG_SLUG || 'jopup-platform';
const DAY_MS = 86400000;
const rows = (result) => result.rows ?? result;

const shape = (r, workspaces) => ({
  id: r.id, plan: r.requestedPlan, name: r.name, email: r.email, company: r.company, phone: r.phone,
  teamSize: r.teamSize, message: r.message, status: r.status, trialDays: r.trialDays, decisionNote: r.decisionNote,
  createdAt: r.createdAt, handledAt: r.handledAt, organisationId: r.organisationId,
  // Workspaces that use this email. Approval needs exactly one, or a choice by the admin.
  workspaces: workspaces || [],
});

class PlatformRequestsService {
  async list({ status = 'pending' } = {}) {
    const q = db.select().from(schema.trialRequest);
    const list = await (status === 'all' ? q : q.where(eq(schema.trialRequest.status, status)))
      .orderBy(sql`${schema.trialRequest.createdAt} DESC`).limit(200);
    const byEmail = await workspacesForEmails([...new Set(list.map((r) => r.email))]);
    return list.map((r) => shape(r, byEmail.get(r.email)));
  }

  async _pending(id) {
    const [r] = await db.select().from(schema.trialRequest).where(eq(schema.trialRequest.id, id));
    if (!r) throw new NotFoundError('Request not found');
    if (r.status !== 'pending') throw new ConflictError('This request has already been handled.');
    return r;
  }

  /** Switch the requester's trialing workspace onto the Enterprise plan for `days`. */
  async approve(id, { days, organisationId, note }, actorId) {
    const r = await this._pending(id);
    if (r.requestedPlan !== 'enterprise') throw new BadRequestError('Only Enterprise trial requests can be approved. Mark a Pro request as contacted.');

    const found = (await workspacesForEmails([r.email])).get(r.email) || [];
    const orgId = organisationId || r.organisationId || (found.length === 1 ? found[0].id : null);
    if (!orgId) {
      throw new BadRequestError(found.length > 1
        ? 'More than one workspace uses this email. Choose which one.'
        : 'No workspace uses this email yet. Ask them to sign up (it is free), then approve.');
    }

    const [org] = await db.select().from(schema.organisation).where(eq(schema.organisation.id, orgId));
    if (!org || org.slug === PLATFORM_ORG_SLUG) throw new NotFoundError('Workspace not found');
    if (org.status !== 'trialing') throw new BadRequestError('Only a workspace that is on a trial can start an Enterprise trial.');

    const [plan] = await db.select().from(schema.plan).where(eq(schema.plan.slug, 'enterprise'));
    if (!plan) throw new BadRequestError('The Enterprise plan is not set up.');

    const endsAt = new Date(Date.now() + days * DAY_MS);
    const credits = trialRules.trialCreditsFor(plan);
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx.update(schema.organisation)
        .set({ planId: plan.id, trialEndsAt: endsAt, updatedAt: now })
        .where(eq(schema.organisation.id, org.id));
      await tx.update(schema.subscription)
        .set({ planId: plan.id, trialEndsAt: endsAt, currentPeriodEnd: endsAt })
        .where(and(eq(schema.subscription.organisationId, org.id), eq(schema.subscription.status, 'trialing')));
      if (credits > 0) {
        const [acct] = await tx.update(schema.creditAccount)
          .set({
            balance: sql`${schema.creditAccount.balance} + ${credits}`,
            lifetimeEarned: sql`${schema.creditAccount.lifetimeEarned} + ${credits}`,
            updatedAt: now,
          })
          .where(eq(schema.creditAccount.organisationId, org.id)).returning();
        if (acct) {
          await tx.insert(schema.creditTransaction).values({
            organisationId: org.id, creditAccountId: acct.id, actorId, type: 'earned',
            amount: credits, balanceAfter: acct.balance, description: 'Enterprise trial credits',
          });
        }
      }
      await tx.update(schema.trialRequest)
        .set({ status: 'approved', organisationId: org.id, trialDays: days, decisionNote: note || null, handledBy: actorId, handledAt: now })
        .where(eq(schema.trialRequest.id, r.id));
    });

    ent.clearCache(org.id); // module gate and write guard read through a 10 s cache
    await auditWrite(org.id, actorId, 'update', 'organisation', org.id,
      { planId: org.planId, trialEndsAt: org.trialEndsAt },
      { planId: plan.id, trialEndsAt: endsAt, action: 'approve_enterprise_trial', requestId: r.id }, 'platform');
    await trySend({ to: r.email, ...mail.approvedMail(r, endsAt) });
    return { organisationId: org.id, trialEndsAt: endsAt };
  }

  /** Close a request without switching anything on. */
  async close(id, status, note, actorId) {
    const r = await this._pending(id);
    await db.update(schema.trialRequest)
      .set({ status, decisionNote: note || null, handledBy: actorId, handledAt: new Date() })
      .where(eq(schema.trialRequest.id, r.id));
    return { id: r.id, status };
  }
}

module.exports = new PlatformRequestsService();
