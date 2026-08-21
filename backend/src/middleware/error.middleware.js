const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
const { env } = require('../config/env');

// 404 handler for any route that didn't match — placed after all routes.
function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// Normalizes known error types (Mongoose validation/cast, JWT, our own
// ApiError) into a consistent JSON shape and status code. Never leaks stack
// traces or internal messages to the client in production.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  let { statusCode, message } = err;
  let details = err.details || null;

  if (err.name === 'ValidationError' && err.errors) {
    statusCode = 400;
    details = Object.values(err.errors).map((e) => e.message);
    message = 'Validation failed';
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid value for field "${err.path}"`;
  } else if (err.name === 'MulterError') {
    statusCode = 400;
    message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'One or more uploaded files exceed the maximum allowed size.'
        : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Too many files uploaded at once.'
          : `Upload failed: ${err.message}`;
  } else if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    message = `${field} already in use`;
  } else if (!(err instanceof ApiError)) {
    // Unexpected/unclassified error — don't leak internals.
    statusCode = 500;
    message = env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  }

  statusCode = statusCode || 500;

  if (statusCode >= 500) {
    logger.error(err.stack || err.message);
  } else {
    logger.warn(`${statusCode} ${req.method} ${req.originalUrl} — ${message}`);
  }

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      ...(details ? { details } : {}),
    },
  });
}

module.exports = { notFoundHandler, errorHandler };
