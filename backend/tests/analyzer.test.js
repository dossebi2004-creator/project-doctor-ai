const {
  analyzeProject,
  detectLanguages,
  detectTestPresence,
  detectDocumentation,
  detectCI,
  detectDocker,
  detectTodoDensity,
  detectDebugStatements,
  detectPossibleSecrets,
} = require('../src/services/analysis/analyzer');

function file(path, content) {
  return { path, content, language: path.split('.').pop() };
}

describe('analyzer', () => {
  describe('detectLanguages', () => {
    it('counts files per detected language, sorted descending', () => {
      const files = [file('a.js', ''), file('b.js', ''), file('c.py', '')];
      const result = detectLanguages(files);
      expect(result[0]).toEqual({ language: 'JavaScript', fileCount: 2 });
      expect(result.find((r) => r.language === 'Python').fileCount).toBe(1);
    });
  });

  describe('detectTestPresence', () => {
    it('detects test files by common naming conventions', () => {
      expect(detectTestPresence([file('foo.test.js', 'x')]).hasTests).toBe(true);
      expect(detectTestPresence([file('src/__tests__/foo.js', 'x')]).hasTests).toBe(true);
      expect(detectTestPresence([file('test_foo.py', 'x')]).hasTests).toBe(true);
      expect(detectTestPresence([file('foo.js', 'x')]).hasTests).toBe(false);
    });
  });

  describe('detectDocumentation', () => {
    it('detects README, LICENSE, CONTRIBUTING presence case-insensitively', () => {
      const result = detectDocumentation([
        file('README.md', 'x'.repeat(300)),
        file('LICENSE', 'MIT'),
        file('CONTRIBUTING.md', 'x'),
      ]);
      expect(result.hasReadme).toBe(true);
      expect(result.hasLicense).toBe(true);
      expect(result.hasContributing).toBe(true);
    });

    it('reports no README when absent', () => {
      const result = detectDocumentation([file('index.js', 'x')]);
      expect(result.hasReadme).toBe(false);
    });
  });

  describe('detectCI', () => {
    it('detects GitHub Actions workflows', () => {
      const result = detectCI([file('.github/workflows/ci.yml', 'x')]);
      expect(result.hasCI).toBe(true);
      expect(result.ciFiles).toContain('.github/workflows/ci.yml');
    });

    it('reports no CI when absent', () => {
      expect(detectCI([file('index.js', 'x')]).hasCI).toBe(false);
    });
  });

  describe('detectDocker', () => {
    it('detects Dockerfile and docker-compose', () => {
      const result = detectDocker([file('Dockerfile', 'FROM node'), file('docker-compose.yml', 'x')]);
      expect(result.hasDocker).toBe(true);
      expect(result.hasDockerCompose).toBe(true);
    });
  });

  describe('detectTodoDensity', () => {
    it('counts TODO/FIXME occurrences', () => {
      const result = detectTodoDensity([file('a.js', '// TODO: fix this\n// FIXME: broken\nconst x = 1;')]);
      expect(result.totalTodos).toBe(2);
    });
  });

  describe('detectDebugStatements', () => {
    it('counts console.log and debugger statements', () => {
      const result = detectDebugStatements([file('a.js', 'console.log("x");\ndebugger;\nconsole.warn("y");')]);
      expect(result.totalDebugStatements).toBe(3);
      expect(result.filesWithDebugStatements).toBe(1);
    });

    it('reports zero for clean files', () => {
      const result = detectDebugStatements([file('a.js', 'const x = 1;')]);
      expect(result.totalDebugStatements).toBe(0);
    });
  });

  describe('detectPossibleSecrets', () => {
    it('flags an AWS access key pattern without echoing the value', () => {
      const result = detectPossibleSecrets([file('config.js', 'const key = "AKIAIOSFODNN7EXAMPLE";')]);
      expect(result.possibleSecretsFound).toBe(true);
      expect(result.locations[0].type).toBe('AWS Access Key');
      expect(JSON.stringify(result)).not.toContain('AKIAIOSFODNN7EXAMPLE');
    });

    it('flags a private key block', () => {
      const result = detectPossibleSecrets([file('key.pem', '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----')]);
      expect(result.possibleSecretsFound).toBe(true);
    });

    it('does not flag clean code', () => {
      const result = detectPossibleSecrets([file('a.js', 'const x = computeSomething();')]);
      expect(result.possibleSecretsFound).toBe(false);
    });
  });

  describe('analyzeProject', () => {
    it('produces a complete summary for a minimal project', () => {
      const files = [file('index.js', 'console.log("hi");'), file('README.md', 'x'.repeat(300))];
      const result = analyzeProject(files);

      expect(result.fileCount).toBe(2);
      expect(result.documentation.hasReadme).toBe(true);
      expect(result.testing.hasTests).toBe(false);
      expect(result.debugStatements.totalDebugStatements).toBe(1);
    });

    it('throws on an empty file list', () => {
      expect(() => analyzeProject([])).toThrow();
    });
  });
});
