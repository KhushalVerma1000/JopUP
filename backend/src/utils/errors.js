class AppError extends Error {
  constructor(message, statusCode, data) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    this.data = data;

    Error.captureStackTrace(this, this.constructor);
  }
}

class BadRequestError extends AppError {
  constructor(message = 'Bad Request') {
    super(message, 400);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
  }
}

class ConflictError extends AppError {
  constructor(message = 'Conflict occurred', data) {
    super(message, 409, data);
  }
}

/**
 * ADR-2: phone-based duplicate detection is a warning, not a hard block —
 * a shared family phone across two real, distinct candidates is a
 * legitimate case. Carries the matched candidate so the caller can offer
 * "view existing" vs. "create anyway" (data.confirmDuplicate: true skips
 * this check and proceeds with creation).
 */
class PossibleDuplicateError extends ConflictError {
  constructor(existingRecord, message = 'A candidate with this phone number may already exist') {
    super(message, { possibleDuplicate: existingRecord });
  }
}

module.exports = {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  PossibleDuplicateError,
};
