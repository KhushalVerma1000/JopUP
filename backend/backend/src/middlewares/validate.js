const { BadRequestError } = require('../utils/errors');

/**
 * A middleware factory to validate requests against a Zod schema.
 * @param {import('zod').ZodSchema} schema
 */
const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse({
    body: req.body,
    query: req.query,
    params: req.params,
  });

  if (!result.success) {
    const errorDetails = result.error.issues.map(
      (err) => `${err.path.slice(1).join('.')}: ${err.message}`
    ).join('; ');
    return next(new BadRequestError(`Validation failed: ${errorDetails}`));
  }

  // Only overwrite req.body/query/params with the parsed value when the
  // schema actually declared that top-level key. Previously this always
  // reassigned all three unconditionally — a schema that only validates
  // `params` (a plain "does this id look like a UUID" check, say) would
  // silently overwrite req.body/req.query to undefined even though it
  // never looked at them. That's harmless when the schema is a route's OWN
  // terminal validator (nothing downstream needs the original body), but
  // it's a real bug when such a schema is used as a router.use()
  // pre-middleware ahead of other routes in the same subtree — e.g.
  // job-portal.routes.js's router.use('/:orgSlug',
  // validate(getPortalOrgParamsSchema), resolveOrg) wiped req.body for
  // every POST under /:orgSlug/* (including /apply) before that route's
  // own validator ever saw the real body. Confirmed via the e2e test
  // script against a live server. For any schema that already declares
  // all three keys (the common case), this is a no-op behavior change.
  if ('body' in result.data) req.body = result.data.body;
  if ('query' in result.data) req.query = result.data.query;
  if ('params' in result.data) req.params = result.data.params;

  next();
};

module.exports = validate;
