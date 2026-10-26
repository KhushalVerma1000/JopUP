/**
 * writeGuard — makes an expired trial (or suspended/cancelled workspace)
 * read-only. Reads keep working so users can still see and export their data.
 *
 * Mounted once in app.js. It verifies the Bearer token itself (best effort,
 * silently) because requireAuth runs later, per router. A missing or bad token
 * is not this middleware's business — requireAuth will reject it.
 *
 * Exempt: safe methods, public/auth/plans/portal, platform staff tooling, the
 * billing area, and credits (platform staff top up expired orgs).
 */
const jwt = require('jsonwebtoken');
const { AppError } = require('../utils/errors');
const ent = require('../utils/entitlements');

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXEMPT_PREFIXES = [
  '/api/v1/auth', '/api/v1/plans', '/api/v1/portal', '/api/v1/platform',
  '/api/v1/platform-admins', '/api/v1/billing', '/api/v1/credits',
  '/api/v1/invitations/accept',
];

const writeGuard = async (req, res, next) => {
  try {
    if (SAFE.has(req.method)) return next();
    const path = req.originalUrl.split('?')[0];
    if (EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))) return next();

    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) return next();
    let decoded;
    try { decoded = jwt.verify(h.split(' ')[1], process.env.JWT_SECRET || 'dev-secret-change-me'); }
    catch { return next(); }
    if (!decoded.organisationId) return next();

    let ctx;
    try { ctx = await ent.loadOrgContext(decoded.organisationId); }
    catch (err) {
      // Fail open: this guard only enforces billing state. If the database is
      // unreachable the request itself will fail with the proper error, and
      // permission checks (403/400) must not be masked by a 500 from here.
      if (process.env.NODE_ENV !== 'test') console.error(`[writeGuard] could not load org state: ${err.message}`);
      return next();
    }
    const block = ent.writeBlock(ctx && ctx.org);
    if (!block) return next();
    return next(new AppError(block.message, 402, { code: block.code }));
  } catch (err) { next(err); }
};

module.exports = writeGuard;
