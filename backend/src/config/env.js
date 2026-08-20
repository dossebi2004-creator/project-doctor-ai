// Centralized environment configuration.
// This is the ONLY place raw `process.env` should be read from throughout
// the backend — every other module must import `env` from here.
// Fails fast (and loudly) if a required variable is missing, instead of
// letting the app boot into a broken state.

require('dotenv').config();

const REQUIRED_IN_PRODUCTION = ['MONGODB_URI', 'JWT_SECRET', 'GEMINI_API_KEY'];

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 5000,

  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/project_doctor_ai',

  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',

  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-1.5-flash',

  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || 'http://localhost:5173',

  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,

  MAX_UPLOAD_FILES: parseInt(process.env.MAX_UPLOAD_FILES, 10) || 40,
  MAX_FILE_SIZE_BYTES: parseInt(process.env.MAX_FILE_SIZE_BYTES, 10) || 300 * 1024, // 300KB/file
};

function validateEnv() {
  if (env.NODE_ENV === 'test') return; // tests supply their own fixtures/mocks

  const missing = REQUIRED_IN_PRODUCTION.filter((key) => !process.env[key]);

  if (env.NODE_ENV === 'production' && missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`[FATAL] Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[WARN] Missing env vars (${missing.join(', ')}) — using defaults/degraded mode. ` +
        'Set these in a .env file before running in production. See .env.example.'
    );
  }
}

module.exports = { env, validateEnv };
