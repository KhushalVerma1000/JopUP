/**
 * requireModule Middleware
 *
 * Checks whether the current tenant's organisation has a specific module enabled.
 * Module access is resolved as: plan.modules, plus the preview plan's modules
 * while a trial preview runs (see entitlements.previewState), then
 * org_module_override rows (an explicit admin "off" always wins).
 *
 * Usage:
 *   router.get('/clients', requireModule('client_management'), controller.list);
 *
 * @param {string} moduleKey  e.g. 'client_management' | 'candidate_db'
 */

const { ForbiddenError, AppError } = require('../utils/errors');
const ent = require('../utils/entitlements');

const requireModule = (moduleKey) => async (req, res, next) => {
  const orgId = req.tenantId;

  if (!orgId) {
    return next(new AppError('Tenant context missing — requireModule depends on tenant middleware', 500));
  }

  try {
    // One shared, 10-second cached read (org + plan + overrides + preview plan)
    // instead of three queries per request. Plain selects, not db.query.*: the
    // relational query API crashes in this codebase (missing relations()).
    const ctx = await ent.loadOrgContext(orgId);
    if (!ctx) return next(new ForbiddenError('Organisation not found'));

    const { modules, preview, locked } = ent.resolveModules(ctx);

    if (!modules.includes(moduleKey)) {
      // A module the trial plan's preview covers: tell the UI it is a taste
      // that has run out (or is offered) so it can show an upgrade prompt.
      if (locked.includes(moduleKey)) {
        const planName = ctx.previewPlan ? ctx.previewPlan.name : 'a higher';
        return next(new AppError(
          `This feature is part of the ${planName} plan. Your ${planName} preview has ended.`,
          403,
          { code: 'MODULE_LOCKED', moduleKey, previewPlan: preview.planSlug, previewEndedAt: preview.endsAt },
        ));
      }
      return next(new AppError(
        `Module '${moduleKey}' is not enabled for your subscription plan`,
        403,
        { code: 'MODULE_NOT_IN_PLAN', moduleKey },
      ));
    }

    // Attach resolved modules to req for downstream use
    req.enabledModules = modules;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = requireModule;
