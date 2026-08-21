const { generateContent } = require('./geminiClient');
const { buildDiagnosisPrompt, VALID_CATEGORIES, VALID_SEVERITIES } = require('./prompts');
const { analyzeProject } = require('../analysis/analyzer');
const { computeHealthScore, buildActionPlan } = require('../analysis/scoring');
const ApiError = require('../../utils/ApiError');
const logger = require('../../config/logger');
const { env } = require('../../config/env');

function stripFences(text) {
  return text
    .trim()
    .replace(/^```(json)?/i, '')
    .replace(/```$/, '')
    .trim();
}

// Validates and normalizes the model's parsed findings so malformed or
// partially-hallucinated output can never propagate into the database or
// the scoring engine. Any finding missing required fields is dropped
// rather than persisted half-formed.
function normalizeFindings(parsed) {
  if (typeof parsed !== 'object' || parsed === null) {
    throw ApiError.internal('AI response was not a valid object');
  }

  const findingsRaw = Array.isArray(parsed.findings) ? parsed.findings : [];

  return findingsRaw
    .filter((f) => f && typeof f === 'object')
    .map((f) => ({
      title: String(f.title || 'Untitled finding').slice(0, 200),
      category: VALID_CATEGORIES.includes(f.category) ? f.category : 'CODE_QUALITY',
      severity: VALID_SEVERITIES.includes(f.severity) ? f.severity : 'MEDIUM',
      file: f.file && typeof f.file === 'string' ? f.file.slice(0, 500) : null,
      description: String(f.description || '').slice(0, 2000),
      evidence: String(f.evidence || '').slice(0, 1500),
      reasoning: String(f.reasoning || '').slice(0, 1500),
      recommendation: String(f.recommendation || '').slice(0, 2000),
      estimatedImpact: String(f.estimatedImpact || '').slice(0, 500),
    }))
    .filter((f) => f.description && f.recommendation);
}

// Public entry point: always runs the deterministic analyzer (never fails
// due to AI issues). Then attempts the AI reasoning step. If the AI step
// fails for any reason (timeout, provider error, unparsable/invalid
// response), the pipeline does NOT fail the whole diagnosis — it falls back
// to a DETERMINISTIC-ONLY result (analyzer signals + score from analyzer
// alone, zero AI findings) and reports that honestly via `aiSucceeded:
// false` + `aiError`. The AI never determines the score either way — it
// only ever supplies raw findings that get validated before counting.
async function diagnoseProject({ projectName, description, files }) {
  const analysis = analyzeProject(files);

  let findings = [];
  let aiSucceeded = false;
  let aiError = null;
  let rawModelResponseTruncated = null;

  try {
    const prompt = buildDiagnosisPrompt({ projectName, description, files, analysis });
    const rawText = await generateContent(prompt);
    rawModelResponseTruncated = rawText.slice(0, 5000);

    let parsed;
    try {
      parsed = JSON.parse(stripFences(rawText));
    } catch (err) {
      throw ApiError.internal('AI returned an unparsable response.');
    }

    findings = normalizeFindings(parsed);
    aiSucceeded = true;
  } catch (err) {
    logger.error(`AI reasoning step failed, falling back to deterministic-only analysis: ${err.message}`);
    aiError = err.message;
  }

  const { overall, dimensions } = computeHealthScore(analysis, findings);
  const actionPlan = buildActionPlan(findings);

  return {
    analysis,
    findings,
    healthScore: overall,
    dimensionScores: dimensions,
    actionPlan,
    aiSucceeded,
    aiError,
    modelUsed: aiSucceeded ? env.GEMINI_MODEL : 'none (deterministic-only)',
    rawModelResponseTruncated,
  };
}

module.exports = { diagnoseProject, normalizeFindings };
