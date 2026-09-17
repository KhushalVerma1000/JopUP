/**
 * requireModule Middleware
 *
 * Checks whether the current tenant's organisation has a specific module enabled.
 * Module access is resolved as: plan.modules + org_module_override rows.
 *
 * Usage:
 *   router.get('/clients', requireModule('client_management'), controller.list);
 *
 * @param {string} moduleKey  e.g. 'client_management' | 'candidate_db'
 */

const { db, schema } = require('../utils/db');
const { eq } = require('drizzle-orm');
const { ForbiddenError, AppError } = require('../utils/errors');

const requireModule = (moduleKey) => async (req, res, next) => {
  const orgId = req.tenantId;

  if (!orgId) {
    return next(new AppError('Tenant context missing — requireModule depends on tenant middleware', 500));
  }

  try {
    // Previously: db.query.organisation.findFirst({ where, with: { plan: true } }).
    // That crashes with "Cannot read properties of undefined (reading
    // 'referencedTable')" — a known drizzle-orm issue (relations.js
    // normalizeRelation) that surfaces on tables with many inbound foreign
    // keys when no explicit relations()/defineRelations() are declared in
    // the schema (none are, anywhere in this codebase — confirmed by grep).
    // Confirmed via the e2e test script against a real Postgres instance:
    // every module-gated route 500'd here regardless of method, since this
    // middleware runs before the controller ever sees the request. Fixed
    // the same way as organization.service.js's identical calls: plain
    // selects instead of the relational query API.
    const [org] = await db.select().from(schema.organisation).where(eq(schema.organisation.id, orgId));

    if (!org) {
      return next(new ForbiddenError('Organisation not found'));
    }

    const [plan] = await db.select().from(schema.plan).where(eq(schema.plan.id, org.planId));

    // Start with plan modules
    const planModules = new Set(plan?.modules || []);

    // Apply per-org overrides
    const overrides = await db
      .select()
      .from(schema.orgModuleOverride)
      .where(eq(schema.orgModuleOverride.organisationId, orgId));

    for (const override of overrides) {
      if (override.enabled) {
        planModules.add(override.moduleKey);
      } else {
        planModules.delete(override.moduleKey);
      }
    }

    if (!planModules.has(moduleKey)) {
      return next(
        new ForbiddenError(
          `Module '${moduleKey}' is not enabled for your subscription plan`
        )
      );
    }

    // Attach resolved modules to req for downstream use
    req.enabledModules = [...planModules];
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = requireModule;
