// Deterministic scoring: turns analyzer signals + validated AI findings into
// a 0-100 health score. The AI never supplies the score directly — it only
// supplies findings, which are validated (diagnosisAgent.js) before being
// counted here. Every dimension score is reproducible from the same inputs.

const DIMENSIONS = ['testing', 'documentation', 'security', 'maintainability', 'devops', 'architecture'];

const SEVERITY_PENALTY = { CRITICAL: 25, HIGH: 15, MEDIUM: 8, LOW: 3, INFO: 0 };

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function findingsByCategory(findings, category) {
  return findings.filter((f) => f.category === category);
}

function penaltyFor(findings) {
  return findings.reduce((sum, f) => sum + (SEVERITY_PENALTY[f.severity] ?? 0), 0);
}

function scoreTesting(analysis, findings) {
  let score = 100;
  const reasons = [];

  if (!analysis.testing.hasTests) {
    score -= 50;
    reasons.push('No test files were detected in the project.');
  } else {
    reasons.push(`${analysis.testing.testFileCount} test file(s) detected.`);
  }

  const testingFindings = findingsByCategory(findings, 'TESTING');
  const penalty = penaltyFor(testingFindings);
  if (penalty > 0) reasons.push(`${testingFindings.length} testing-related finding(s) from AI review.`);
  score -= penalty;

  return { score: clamp(score), reasons };
}

function scoreDocumentation(analysis, findings) {
  let score = 100;
  const reasons = [];

  if (!analysis.documentation.hasReadme) {
    score -= 40;
    reasons.push('No README file found.');
  } else if (analysis.documentation.readmeLength < 200) {
    score -= 15;
    reasons.push('README exists but is very short.');
  } else {
    reasons.push('README file present with reasonable length.');
  }

  if (!analysis.documentation.hasLicense) {
    score -= 10;
    reasons.push('No LICENSE file found.');
  }

  const docFindings = findingsByCategory(findings, 'DOCUMENTATION');
  score -= penaltyFor(docFindings);
  if (docFindings.length > 0) reasons.push(`${docFindings.length} documentation finding(s) from AI review.`);

  return { score: clamp(score), reasons };
}

function scoreSecurity(analysis, findings) {
  let score = 100;
  const reasons = [];

  if (analysis.possibleSecrets.possibleSecretsFound) {
    score -= 40;
    reasons.push(`${analysis.possibleSecrets.count} possible hardcoded secret(s) detected.`);
  }

  const securityFindings = findingsByCategory(findings, 'SECURITY');
  const penalty = penaltyFor(securityFindings);
  score -= penalty;
  if (securityFindings.length > 0) {
    reasons.push(`${securityFindings.length} security finding(s) from AI review.`);
  }
  if (securityFindings.length === 0 && !analysis.possibleSecrets.possibleSecretsFound) {
    reasons.push('No security issues detected by static checks or AI review.');
  }

  return { score: clamp(score), reasons };
}

function scoreMaintainability(analysis, findings) {
  let score = 100;
  const reasons = [];

  if (analysis.largeFiles.length > 0) {
    const deduction = Math.min(20, analysis.largeFiles.length * 5);
    score -= deduction;
    reasons.push(`${analysis.largeFiles.length} unusually large file(s) detected.`);
  }

  if (analysis.todos.todosPer1000Lines > 5) {
    score -= 10;
    reasons.push(`High TODO/FIXME density (${analysis.todos.todosPer1000Lines} per 1000 lines).`);
  }

  if (analysis.debugStatements.totalDebugStatements > 0) {
    const deduction = Math.min(15, analysis.debugStatements.filesWithDebugStatements * 2);
    score -= deduction;
    reasons.push(`${analysis.debugStatements.totalDebugStatements} debug statement(s) left in source.`);
  }

  const maintFindings = [...findingsByCategory(findings, 'CODE_QUALITY'), ...findingsByCategory(findings, 'BUG')];
  score -= penaltyFor(maintFindings);
  if (maintFindings.length > 0) reasons.push(`${maintFindings.length} code quality/bug finding(s) from AI review.`);

  if (reasons.length === 0) reasons.push('No maintainability issues detected.');

  return { score: clamp(score), reasons };
}

function scoreDevops(analysis, findings) {
  let score = 100;
  const reasons = [];

  if (!analysis.ci.hasCI) {
    score -= 25;
    reasons.push('No CI configuration detected.');
  } else {
    reasons.push('CI configuration present.');
  }

  if (!analysis.docker.hasDocker) {
    score -= 10;
    reasons.push('No Dockerfile detected (may be intentional depending on deployment target).');
  }

  const devopsFindings = findingsByCategory(findings, 'DEVOPS');
  score -= penaltyFor(devopsFindings);
  if (devopsFindings.length > 0) reasons.push(`${devopsFindings.length} DevOps finding(s) from AI review.`);

  return { score: clamp(score), reasons };
}

function scoreArchitecture(analysis, findings) {
  let score = 100;
  const reasons = [];

  const archFindings = [
    ...findingsByCategory(findings, 'ARCHITECTURE'),
    ...findingsByCategory(findings, 'PERFORMANCE'),
    ...findingsByCategory(findings, 'DEPENDENCY'),
  ];
  score -= penaltyFor(archFindings);
  if (archFindings.length > 0) {
    reasons.push(`${archFindings.length} architecture/performance/dependency finding(s) from AI review.`);
  } else {
    reasons.push('No architectural concerns raised by AI review.');
  }

  if (analysis.dependencies.dependencyCount > 100) {
    score -= 10;
    reasons.push(`Large dependency surface (${analysis.dependencies.dependencyCount} dependencies).`);
  }

  return { score: clamp(score), reasons };
}

const SCORERS = {
  testing: scoreTesting,
  documentation: scoreDocumentation,
  security: scoreSecurity,
  maintainability: scoreMaintainability,
  devops: scoreDevops,
  architecture: scoreArchitecture,
};

// Weights sum to 1. Security and testing are weighted highest since they
// carry the most real-world risk; documentation/devops lowest.
const WEIGHTS = {
  security: 0.25,
  testing: 0.2,
  maintainability: 0.2,
  architecture: 0.15,
  devops: 0.1,
  documentation: 0.1,
};

// Computes the full deterministic score: per-dimension scores with reasons,
// plus a single weighted overall score. Same (analysis, findings) input
// always produces the same output.
function computeHealthScore(analysis, findings = []) {
  const dimensions = {};
  for (const dim of DIMENSIONS) {
    dimensions[dim] = SCORERS[dim](analysis, findings);
  }

  const overall = clamp(
    Math.round(DIMENSIONS.reduce((sum, dim) => sum + dimensions[dim].score * WEIGHTS[dim], 0))
  );

  return { overall, dimensions };
}

const SEVERITY_TO_PRIORITY = { CRITICAL: 'P0', HIGH: 'P1', MEDIUM: 'P2', LOW: 'P3', INFO: 'P3' };

// Builds a prioritized action plan directly from validated findings —
// deterministic given the same findings input (severity drives priority,
// then category as a stable tiebreaker).
function buildActionPlan(findings = []) {
  const plan = { P0: [], P1: [], P2: [], P3: [] };

  const sorted = [...findings].sort((a, b) => {
    const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
    return (order[a.severity] ?? 5) - (order[b.severity] ?? 5) || a.category.localeCompare(b.category);
  });

  for (const finding of sorted) {
    const priority = SEVERITY_TO_PRIORITY[finding.severity] || 'P3';
    plan[priority].push({
      title: finding.title,
      category: finding.category,
      severity: finding.severity,
      recommendation: finding.recommendation,
      file: finding.file || null,
    });
  }

  return plan;
}

module.exports = { computeHealthScore, buildActionPlan, DIMENSIONS, WEIGHTS };
