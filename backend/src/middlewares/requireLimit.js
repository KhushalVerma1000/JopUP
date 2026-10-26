/**
 * requireLimit(limitKey, adding?) — blocks a create when it would push the
 * organisation past its plan limit.
 *
 *   router.post('/', requireLimit('max_clients'), controller.create)
 *   router.post('/bulk-create', requireLimit('max_candidates', (req) => req.body.items.length), ...)
 *
 * Must run after requireAuth (needs req.tenantId). A batch that does not fit is
 * rejected whole, with the remaining headroom in the response so the UI can
 * ask the user to trim it.
 */
const { AppError } = require('../utils/errors');
const ent = require('../utils/entitlements');

const requireLimit = (limitKey, adding = () => 1) => async (req, res, next) => {
  try {
    const def = ent.LIMITS[limitKey];
    if (!def) return next(new AppError(`Unknown plan limit: ${limitKey}`, 500));
    if (!req.tenantId) return next(new AppError('Tenant context missing — requireLimit runs after requireAuth', 500));

    const ctx = await ent.loadOrgContext(req.tenantId);
    if (!ctx) return next();
    const limit = ((ctx.plan && ctx.plan.limits) || {})[limitKey];
    if (ent.isUnlimited(limit)) return next();

    const n = Math.max(1, Number(adding(req)) || 1);
    const result = ent.checkLimit(limit, await def.count(req.tenantId), n);
    if (result.ok) return next();

    const planName = ctx.plan ? ctx.plan.name : 'current';
    const message = n > 1 && result.remaining > 0
      ? `Your ${planName} plan has room for ${result.remaining} more ${def.label}, but this request adds ${n}. Remove some or upgrade.`
      : `You have reached the ${def.label} limit (${result.limit}) on your ${planName} plan. Upgrade to add more.`;
    return next(new AppError(message, 403, { code: 'PLAN_LIMIT', limitKey, limit: result.limit, current: result.current, remaining: result.remaining, requested: n }));
  } catch (err) { next(err); }
};

module.exports = requireLimit;
