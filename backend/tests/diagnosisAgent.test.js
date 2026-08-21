process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.GEMINI_API_KEY = 'test-key';

const { normalizeFindings } = require('../src/services/ai/diagnosisAgent');
const ApiError = require('../src/utils/ApiError');

describe('normalizeFindings', () => {
  it('normalizes a well-formed AI response', () => {
    const parsed = {
      findings: [
        {
          title: 'Missing input validation',
          category: 'SECURITY',
          severity: 'HIGH',
          file: 'src/routes/user.js',
          description: 'User input is passed directly to the database query.',
          evidence: 'db.query(`SELECT * FROM users WHERE id = ${req.params.id}`)',
          reasoning: 'This allows SQL injection.',
          recommendation: 'Use parameterized queries.',
          estimatedImpact: 'Full database compromise possible.',
        },
      ],
    };

    const result = normalizeFindings(parsed);

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('SECURITY');
    expect(result[0].severity).toBe('HIGH');
    expect(result[0].recommendation).toContain('parameterized');
  });

  it('defaults an invalid category/severity to safe fallbacks', () => {
    const result = normalizeFindings({
      findings: [
        {
          title: 'Weird finding',
          category: 'not-a-real-category',
          severity: 'catastrophic',
          description: 'Some description',
          recommendation: 'Some recommendation',
        },
      ],
    });

    expect(result[0].category).toBe('CODE_QUALITY');
    expect(result[0].severity).toBe('MEDIUM');
  });

  it('drops findings missing required description/recommendation', () => {
    const result = normalizeFindings({
      findings: [{ title: 'Incomplete finding', category: 'BUG', severity: 'LOW' }],
    });

    expect(result).toHaveLength(0);
  });

  it('returns an empty array when findings is missing entirely', () => {
    const result = normalizeFindings({});
    expect(result).toEqual([]);
  });

  it('ignores non-object entries in the findings array', () => {
    const result = normalizeFindings({ findings: [null, 'not an object', 42] });
    expect(result).toEqual([]);
  });

  it('throws when the parsed value is not an object', () => {
    expect(() => normalizeFindings(null)).toThrow(ApiError);
    expect(() => normalizeFindings('a string')).toThrow(ApiError);
  });

  it('truncates overly long fields rather than rejecting the finding', () => {
    const longText = 'x'.repeat(5000);
    const result = normalizeFindings({
      findings: [
        {
          title: longText,
          category: 'BUG',
          severity: 'LOW',
          description: longText,
          recommendation: longText,
        },
      ],
    });

    expect(result[0].title.length).toBeLessThanOrEqual(200);
    expect(result[0].description.length).toBeLessThanOrEqual(2000);
    expect(result[0].recommendation.length).toBeLessThanOrEqual(2000);
  });
});

describe('diagnoseProject (deterministic-only fallback)', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('../src/services/ai/geminiClient');
  });

  it('falls back to a deterministic-only result when the AI call fails, without throwing', async () => {
    jest.resetModules();
    jest.doMock('../src/services/ai/geminiClient', () => ({
      generateContent: jest.fn().mockRejectedValue(new Error('provider unreachable')),
    }));
    // eslint-disable-next-line global-require
    const { diagnoseProject } = require('../src/services/ai/diagnosisAgent');

    const result = await diagnoseProject({
      projectName: 'Demo',
      description: '',
      files: [{ path: 'index.js', content: 'console.log("hi");' }],
    });

    expect(result.aiSucceeded).toBe(false);
    expect(result.aiError).toBeTruthy();
    expect(result.findings).toEqual([]);
    expect(typeof result.healthScore).toBe('number');
    expect(result.healthScore).toBeGreaterThanOrEqual(0);
    expect(result.modelUsed).toMatch(/deterministic-only/);
  });

  it('returns aiSucceeded: true with findings when the AI call succeeds', async () => {
    jest.resetModules();
    jest.doMock('../src/services/ai/geminiClient', () => ({
      generateContent: jest.fn().mockResolvedValue(
        JSON.stringify({
          findings: [
            {
              title: 'No tests',
              category: 'TESTING',
              severity: 'MEDIUM',
              description: 'No test files found.',
              recommendation: 'Add unit tests.',
            },
          ],
        })
      ),
    }));
    // eslint-disable-next-line global-require
    const { diagnoseProject } = require('../src/services/ai/diagnosisAgent');

    const result = await diagnoseProject({
      projectName: 'Demo',
      description: '',
      files: [{ path: 'index.js', content: 'console.log("hi");' }],
    });

    expect(result.aiSucceeded).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.modelUsed).not.toMatch(/deterministic-only/);
  });
});
