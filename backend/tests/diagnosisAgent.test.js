process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.GEMINI_API_KEY = 'test-key';

const { normalizeDiagnosis } = require('../src/services/ai/diagnosisAgent');
const ApiError = require('../src/utils/ApiError');

describe('normalizeDiagnosis', () => {
  it('normalizes a well-formed AI response', () => {
    const parsed = {
      summary: 'The project is reasonably solid but has a few security gaps.',
      healthScore: 72,
      findings: [
        {
          title: 'Missing input validation',
          category: 'security',
          severity: 'high',
          file: 'src/routes/user.js',
          explanation: 'User input is passed directly to the database query.',
          recommendation: 'Validate and sanitize all inputs before use.',
        },
      ],
    };

    const result = normalizeDiagnosis(parsed);

    expect(result.summary).toBe(parsed.summary);
    expect(result.healthScore).toBe(72);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].category).toBe('security');
  });

  it('clamps an out-of-range health score', () => {
    const result = normalizeDiagnosis({ summary: 'ok', healthScore: 150, findings: [] });
    expect(result.healthScore).toBe(100);

    const result2 = normalizeDiagnosis({ summary: 'ok', healthScore: -20, findings: [] });
    expect(result2.healthScore).toBe(0);
  });

  it('defaults an invalid category/severity to safe fallbacks', () => {
    const result = normalizeDiagnosis({
      summary: 'ok',
      healthScore: 50,
      findings: [
        {
          title: 'Weird finding',
          category: 'not-a-real-category',
          severity: 'catastrophic',
          explanation: 'Some explanation',
          recommendation: 'Some recommendation',
        },
      ],
    });

    expect(result.findings[0].category).toBe('maintainability');
    expect(result.findings[0].severity).toBe('medium');
  });

  it('drops findings missing required explanation/recommendation', () => {
    const result = normalizeDiagnosis({
      summary: 'ok',
      healthScore: 50,
      findings: [{ title: 'Incomplete finding', category: 'bug', severity: 'low' }],
    });

    expect(result.findings).toHaveLength(0);
  });

  it('throws when summary is missing', () => {
    expect(() => normalizeDiagnosis({ healthScore: 50, findings: [] })).toThrow(ApiError);
  });

  it('throws when the parsed value is not an object', () => {
    expect(() => normalizeDiagnosis(null)).toThrow(ApiError);
    expect(() => normalizeDiagnosis('a string')).toThrow(ApiError);
  });
});
