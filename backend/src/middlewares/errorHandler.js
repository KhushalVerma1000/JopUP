/**
 * Global Centralized Error Handler Middleware
 *
 * Handles:
 *   - Zod validation errors (from validate.js middleware)
 *   - Custom AppError subclasses (BadRequestError, NotFoundError, etc.)
 *   - Unhandled runtime errors (500)
 */

const { ZodError } = require('zod');
const { AppError } = require('../utils/errors');

const errorHandler = (err, req, res, next) => {
  // ── Zod Validation Error ──────────────────────────────────
  if (err instanceof ZodError) {
    const fieldErrors = err.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    return res.status(400).json({
      status: 'fail',
      message: 'Validation failed',
      errors: fieldErrors,
    });
  }

  // ── Operational AppError ──────────────────────────────────
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
    });
  }

  // ── PostgreSQL / Drizzle Known Errors ─────────────────────
  // Unique constraint violation
  if (err.code === '23505') {
    return res.status(409).json({
      status: 'fail',
      message: 'A record with these values already exists.',
      detail: err.detail || undefined,
    });
  }
  // Foreign key violation
  if (err.code === '23503') {
    return res.status(400).json({
      status: 'fail',
      message: 'Referenced record does not exist.',
      detail: err.detail || undefined,
    });
  }

  // ── Unknown / Programming Error ───────────────────────────
  console.error('Unhandled Error:', err);

  return res.status(500).json({
    status: 'error',
    message: 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = errorHandler;
