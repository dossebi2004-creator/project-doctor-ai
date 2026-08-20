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

// Sends a single prompt to Gemini and returns the raw text response.
// Isolated here so the rest of the app never touches the SDK directly —
// makes it trivial to swap providers or mock in tests.
async function generateContent(prompt, { temperature = 0.3 } = {}) {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({
    model: env.GEMINI_MODEL,
    generationConfig: { temperature, responseMimeType: 'application/json' },
  });

  try {
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err) {
    logger.error(`Gemini API call failed: ${err.message}`);
    throw ApiError.internal('AI provider request failed. Please try again shortly.');
  }
}

module.exports = { generateContent };
