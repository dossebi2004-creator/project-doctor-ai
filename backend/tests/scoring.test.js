const { computeHealthScore, buildActionPlan } = require('../src/services/analysis/scoring');
const { analyzeProject } = require('../src/services/analysis/analyzer');

function file(path, content) {
  return { path, content };
}

describe('computeHealthScore', () => {
  it('scores a clean, well-equipped project highly', () => {
    const files = [
      file('index.js', 'module.exports = () => 1;'),
      file('index.test.js', 'test("works", () => expect(1).toBe(1));'),
      file('README.md', 'x'.repeat(500)),
      file('LICENSE', 'MIT'),
      file('.github/workflows/ci.yml', 'name: CI'),
      file('Dockerfile', 'FROM node'),
      file('package.json', '{"dependencies": {}}'),
    ];
    const analysis = analyzeProject(files);
    const { overall, dimensions } = computeHealthScore(analysis, []);

    expect(overall).toBeGreaterThanOrEqual(85);
    expect(dimensions.testing.score).toBe(100);
    expect(dimensions.documentation.score).toBe(100);
  });

  it('penalizes a project with no tests, no README, no CI', () => {
    const files = [file('index.js', 'console.log("x");')];
    const analysis = analyzeProject(files);
    const { overall, dimensions } = computeHealthScore(analysis, []);

    expect(overall).toBeLessThan(90);
    expect(dimensions.testing.score).toBeLessThan(100);
    expect(dimensions.documentation.score).toBeLessThan(100);
    expect(dimensions.devops.score).toBeLessThan(100);
  });

  it('is deterministic — same inputs always produce the same score', () => {
    const files = [file('index.js', 'const x = 1;'), file('README.md', 'hello')];
    const analysis = analyzeProject(files);
    const findings = [
      { category: 'SECURITY', severity: 'HIGH', title: 'x', recommendation: 'y' },
    ];

    const first = computeHealthScore(analysis, findings);
    const second = computeHealthScore(analysis, findings);

    expect(first).toEqual(second);
  });

  it('applies a larger penalty for CRITICAL findings than LOW findings', () => {
    const files = [file('index.js', 'const x = 1;')];
    const analysis = analyzeProject(files);

    const withCritical = computeHealthScore(analysis, [
      { category: 'SECURITY', severity: 'CRITICAL', title: 'x', recommendation: 'y' },
    ]);
    const withLow = computeHealthScore(analysis, [
      { category: 'SECURITY', severity: 'LOW', title: 'x', recommendation: 'y' },
    ]);

    expect(withCritical.dimensions.security.score).toBeLessThan(withLow.dimensions.security.score);
  });

  it('never produces a score outside 0-100', () => {
    const files = [file('index.js', 'const x = 1;')];
    const analysis = analyzeProject(files);
    const manyFindings = Array.from({ length: 20 }, () => ({
      category: 'SECURITY',
      severity: 'CRITICAL',
      title: 'x',
      recommendation: 'y',
    }));

    const { overall, dimensions } = computeHealthScore(analysis, manyFindings);
    expect(overall).toBeGreaterThanOrEqual(0);
    expect(overall).toBeLessThanOrEqual(100);
    Object.values(dimensions).forEach((d) => {
      expect(d.score).toBeGreaterThanOrEqual(0);
      expect(d.score).toBeLessThanOrEqual(100);
    });
  });
});

describe('buildActionPlan', () => {
  it('groups findings into P0-P3 by severity', () => {
    const findings = [
      { title: 'a', category: 'SECURITY', severity: 'CRITICAL', recommendation: 'fix a' },
      { title: 'b', category: 'BUG', severity: 'HIGH', recommendation: 'fix b' },
      { title: 'c', category: 'CODE_QUALITY', severity: 'MEDIUM', recommendation: 'fix c' },
      { title: 'd', category: 'DOCUMENTATION', severity: 'LOW', recommendation: 'fix d' },
      { title: 'e', category: 'DOCUMENTATION', severity: 'INFO', recommendation: 'fix e' },
    ];

    const plan = buildActionPlan(findings);

    expect(plan.P0).toHaveLength(1);
    expect(plan.P1).toHaveLength(1);
    expect(plan.P2).toHaveLength(1);
    expect(plan.P3).toHaveLength(2); // LOW and INFO both map to P3
    expect(plan.P0[0].title).toBe('a');
  });

  it('returns an empty plan for no findings', () => {
    const plan = buildActionPlan([]);
    expect(plan).toEqual({ P0: [], P1: [], P2: [], P3: [] });
  });
});
