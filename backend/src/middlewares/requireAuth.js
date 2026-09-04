/**
 * requireAuth Middleware
 *
 * Verifies the JWT token from the Authorization header.
 * On success, attaches decoded user info to req.user.
 *
 * JWT payload shape:
 *   { userId, organisationId, email, roles: [{ teamId, roleName, permissions }] }
 *
 * Usage:
 *   router.get('/protected', requireAuth, controller.handler);
 */

const jwt = require('jsonwebtoken');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');

const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing or invalid Authorization header'));
  }

  const token = authHeader.split(' ')[1];

  try {
    const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    // Also set tenantId from JWT for downstream middleware
    req.tenantId = decoded.organisationId;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new UnauthorizedError('Token expired'));
    }
    return next(new UnauthorizedError('Invalid token'));
  }
};

/**
 * requirePermission — checks if the user has a specific permission
 * Must run AFTER requireAuth.
 *
 * @param {string} entity  e.g. 'clients' | 'candidates' | 'job_postings'
 * @param {string} action  e.g. 'read' | 'write' | 'delete' | 'publish'
 */
const requirePermission = (entity, action) => (req, res, next) => {
  // Not authenticated at all — a token is required first.
  if (!req.user || !req.user.roles) {
    return next(new UnauthorizedError('No roles found in token'));
  }

  const hasPermission = req.user.roles.some((role) => {
    const perms = role.permissions?.[entity];
    return perms && perms.includes(action);
  });

  // Authenticated, but the token's roles don't include this permission —
  // this is a 403 (Forbidden), not a 401 (Unauthorized): the caller has
  // already proven who they are, they just aren't allowed to do this.
  if (!hasPermission) {
    return next(
      new ForbiddenError(`Permission denied: ${entity}.${action}`)
    );
  }

  next();
};

module.exports = { requireAuth, requirePermission };
