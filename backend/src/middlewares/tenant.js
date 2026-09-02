/**
 * Tenant Middleware
 *
 * Extracts the organisation_id from the request headers and attaches
 * it to `req.tenantId`. Every authenticated route that is scoped to a
 * tenant depends on this middleware running first.
 *
 * Header: x-tenant-id: <organisation_uuid>
 *
 * In production this is typically derived from the JWT payload:
 *   req.tenantId = req.user.organisationId
 * but keeping it as a header extraction makes development and testing simpler.
 */

const { UnauthorizedError } = require('../utils/errors');

const tenant = (req, res, next) => {
  // Skip tenant verification for public/health/portal/signup endpoints
  if (
    req.path === '/api/health' ||
    req.path.startsWith('/api/v1/plans') ||
    req.path.startsWith('/api/v1/portal') ||
    req.path.startsWith('/api/v1/auth') ||
    (req.path === '/api/v1/organizations' && req.method === 'POST')
  ) {
    return next();
  }

  // Prefer JWT-derived tenant (set by requireAuth middleware when used)
  if (req.user && req.user.organisationId) {
    req.tenantId = req.user.organisationId;
    return next();
  }

  // A Bearer token is present but hasn't been verified yet — requireAuth runs
  // *after* this global middleware on now-protected routes (candidates, clients,
  // teams, job-postings, applications, performance, credits, workflow, org
  // read/update). Defer to it instead of demanding x-tenant-id too; requireAuth
  // will set req.tenantId from the verified JWT, or reject with 401 itself.
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    return next();
  }

  const tenantId = req.headers['x-tenant-id'];

  if (!tenantId) {
    return next(new UnauthorizedError('Missing x-tenant-id header'));
  }

  // In production, enforce UUID format; in dev/test, accept any non-empty string
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(tenantId)) {
      return next(new UnauthorizedError('Invalid x-tenant-id format'));
    }
  }

  req.tenantId = tenantId;
  next();
};

module.exports = tenant;
