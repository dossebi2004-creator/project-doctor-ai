const { generateContent } = require('./geminiClient');
const { buildDiagnosisPrompt } = require('./prompts');
const ApiError = require('../../utils/ApiError');
const logger = require('../../config/logger');
const { env } = require('../../config/env');

const VALID_CATEGORIES = [
  'bug',
  'security',
  'performance',
  'maintainability',
  'architecture',
  'testing',
  'style',
];
const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

// Strips markdown code fences if the model wraps its JSON despite instructions.
function stripFences(text) {
  return text
    .trim()
    .replace(/^```(json)?/i, '')
    .replace(/```$/, '')
    .trim();
}

// Validates and normalizes the model's parsed JSON so a malformed or
// partially-hallucinated response can never propagate malformed data into
// the database or the API response.
function normalizeDiagnosis(parsed) {
  if (typeof parsed !== 'object' || parsed === null) {
    throw ApiError.internal('AI response was not a valid object');
  }

  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
  if (!summary) throw ApiError.internal('AI response missing summary');

  let healthScore = Number(parsed.healthScore);
  if (!Number.isFinite(healthScore)) healthScore = 50;
  healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));

  const findingsRaw = Array.isArray(parsed.findings) ? parsed.findings : [];
  const findings = findingsRaw
    .filter((f) => f && typeof f === 'object')
    .map((f) => ({
      title: String(f.title || 'Untitled finding').slice(0, 200),
      category: VALID_CATEGORIES.includes(f.category) ? f.category : 'maintainability',
      severity: VALID_SEVERITIES.includes(f.severity) ? f.severity : 'medium',
      file: f.file && typeof f.file === 'string' ? f.file.slice(0, 500) : null,
      explanation: String(f.explanation || '').slice(0, 3000),
      recommendation: String(f.recommendation || '').slice(0, 2000),
    }))
    .filter((f) => f.explanation && f.recommendation);

  return { summary, healthScore, findings };
}

// Public entry point: runs the full diagnosis pipeline for a project and
// returns a normalized result ready to persist as a Diagnosis document.
async function diagnoseProject({ projectName, description, files }) {
  const prompt = buildDiagnosisPrompt({ projectName, description, files });

  const rawText = await generateContent(prompt);

  let parsed;
  try {
    parsed = JSON.parse(stripFences(rawText));
  } catch (err) {
    logger.error(`Failed to parse AI response as JSON: ${err.message}`);
    throw ApiError.internal('AI returned an unparsable response. Please retry.');
  }

  const normalized = normalizeDiagnosis(parsed);

  return {
    ...normalized,
    modelUsed: env.GEMINI_MODEL,
    rawModelResponseTruncated: rawText.slice(0, 5000),
  };
}

module.exports = { diagnoseProject, normalizeDiagnosis };
