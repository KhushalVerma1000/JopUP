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
    // Load org with its plan
    const org = await db.query.organisation.findFirst({
      where: eq(schema.organisation.id, orgId),
      with: { plan: true },
    });

    if (!org) {
      return next(new ForbiddenError('Organisation not found'));
    }

    // Start with plan modules
    const planModules = new Set(org.plan?.modules || []);

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
