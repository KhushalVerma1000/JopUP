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

  // Update req object with parsed/validated data
  req.body = result.data.body;
  req.query = result.data.query;
  req.params = result.data.params;

  next();
};

module.exports = validate;
