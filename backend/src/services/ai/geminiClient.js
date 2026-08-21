const { GoogleGenerativeAI } = require('@google/generative-ai');
const { env } = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const logger = require('../../config/logger');

let client = null;

function getClient() {
  if (!env.GEMINI_API_KEY) {
    throw ApiError.internal(
      'AI service is not configured (GEMINI_API_KEY missing). Set it in your .env file.'
    );
  }
  if (!client) {
    client = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  }
  return client;
}

const DEFAULT_TIMEOUT_MS = 45000;

// Sends a single prompt to Gemini and returns the raw text response.
// Isolated here so the rest of the app never touches the SDK directly —
// makes it trivial to swap providers or mock in tests. Enforces a hard
// timeout so a slow/hanging AI provider call can never leave a request
// (or a diagnosis stuck in 'analyzing') hanging indefinitely. Retries once
// on a transient provider failure (not on timeout — a slow provider is
// unlikely to suddenly be fast on retry, and doubling the wait is worse UX).
async function generateContent(prompt, { temperature = 0.3, timeoutMs = DEFAULT_TIMEOUT_MS, _retried = false } = {}) {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({
    model: env.GEMINI_MODEL,
    generationConfig: { temperature, responseMimeType: 'application/json' },
  });

  let timeoutHandle;
  let timedOut = false;
  const timeoutPromise = new Promise((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      reject(ApiError.internal('AI provider request timed out. Please try again.'));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([model.generateContent(prompt), timeoutPromise]);
    return result.response.text();
  } catch (err) {
    if (timedOut) throw err; // don't retry a timeout — retrying would just double the wait

    if (!_retried) {
      logger.warn(`Gemini API call failed, retrying once: ${err.message}`);
      return generateContent(prompt, { temperature, timeoutMs, _retried: true });
    }

    logger.error(`Gemini API call failed after retry: ${err.message}`);
    throw ApiError.internal('AI provider request failed. Please try again shortly.');
  } finally {
    clearTimeout(timeoutHandle);
  }
}

module.exports = { generateContent };
