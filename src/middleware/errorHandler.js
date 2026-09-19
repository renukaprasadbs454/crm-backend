export class AppError extends Error {
  constructor(message, status = 400, errors = null, retryAfterSeconds = null) {
    super(message);
    this.status = status;
    this.errors = errors;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function errorHandler(err, _req, res, _next) {
  if (err.name === 'ZodError') {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: err.errors,
    });
  }

  if (err.code === 'P2002') {
    const target = err.meta?.target?.[0] || 'field';
    return res.status(409).json({
      success: false,
      message: `${target} already exists`,
      errors: null,
    });
  }

  const status = err.status || 500;
  const message = err.message || 'Internal server error';

  if (err.retryAfterSeconds) res.setHeader('Retry-After', String(err.retryAfterSeconds));

  if (status >= 500) {
    console.error(err);
  }

  return res.status(status).json({
    success: false,
    message,
    errors: err.errors || null,
  });
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
