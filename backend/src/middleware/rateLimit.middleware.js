const rateLimit = require('express-rate-limit');
const { env } = require('../config/env');

// General API limiter — applied to the whole app.
const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many requests, please try again later.' } },
});

// Tighter limiter for auth endpoints (brute-force protection).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many auth attempts, please try again later.' } },
});

// Stricter limiter for the AI diagnosis endpoint — each call costs real
// tokens/quota against the Gemini API.
const diagnosisLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Diagnosis rate limit reached, try again in an hour.' } },
});

module.exports = { apiLimiter, authLimiter, diagnosisLimiter };
