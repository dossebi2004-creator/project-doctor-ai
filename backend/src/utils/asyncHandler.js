// Wraps an async route/controller so rejected promises are forwarded to
// Express's error handler instead of crashing the process or hanging the
// request. Avoids a try/catch block in every single controller.
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
