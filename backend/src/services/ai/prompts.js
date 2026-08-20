// Builds the diagnosis prompt sent to the AI model. Kept isolated from the
// agent logic so the prompt can be iterated on without touching parsing code.

const RESPONSE_SCHEMA_HINT = `
Respond with STRICT JSON only, matching exactly this shape (no markdown fences, no prose outside the JSON):
{
  "summary": "2-4 sentence overall assessment of the project",
  "healthScore": <integer 0-100, 100 = excellent>,
  "findings": [
    {
      "title": "short finding title",
      "category": "bug" | "security" | "performance" | "maintainability" | "architecture" | "testing" | "style",
      "severity": "critical" | "high" | "medium" | "low" | "info",
      "file": "relative/path/or/null",
      "explanation": "what the problem is and why it matters",
      "recommendation": "concrete, actionable fix"
    }
  ]
}`;

function buildDiagnosisPrompt({ projectName, description, files }) {
  const fileBlocks = files
    .map((f) => `--- FILE: ${f.path} (${f.language || 'plaintext'}) ---\n${f.content}`)
    .join('\n\n');

  return `You are an expert senior software architect performing a code review and diagnosis.

Project name: ${projectName}
Project description: ${description || '(none provided)'}

Analyze the following source files. Identify concrete bugs, security vulnerabilities,
performance issues, maintainability problems, architectural concerns, missing tests,
and significant style issues. Be specific and reference file paths and line-level
detail where possible. Do not invent issues that are not supported by the code shown.
If the code is clean in some area, do not fabricate a finding just to fill space.

${fileBlocks}

${RESPONSE_SCHEMA_HINT}`;
}

module.exports = { buildDiagnosisPrompt };
