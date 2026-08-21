// Deterministic, rule-based analysis of a project's file set. Runs entirely
// without AI — every signal here is computed from the actual file paths and
// contents, so results are reproducible and cheap. The diagnosis pipeline
// feeds this summary into the AI prompt (prompts.js) and into scoring.js,
// which uses these signals directly for parts of the health score that
// should never depend on what an LLM decides to say.

const LANGUAGE_BY_EXT = {
  js: 'JavaScript', jsx: 'JavaScript (React)', ts: 'TypeScript', tsx: 'TypeScript (React)',
  py: 'Python', java: 'Java', go: 'Go', rb: 'Ruby', php: 'PHP', c: 'C', cpp: 'C++',
  h: 'C/C++ Header', hpp: 'C++ Header', cs: 'C#', sql: 'SQL', sh: 'Shell',
  html: 'HTML', css: 'CSS', scss: 'SCSS', yml: 'YAML', yaml: 'YAML', json: 'JSON', md: 'Markdown',
};

const FRAMEWORK_SIGNATURES = [
  { name: 'React', test: (deps, files) => 'react' in deps || files.some((f) => f.path.endsWith('.jsx') || f.path.endsWith('.tsx')) },
  { name: 'Vue', test: (deps) => 'vue' in deps },
  { name: 'Angular', test: (deps) => '@angular/core' in deps },
  { name: 'Express', test: (deps) => 'express' in deps },
  { name: 'Next.js', test: (deps) => 'next' in deps },
  { name: 'Django', test: (_deps, files) => files.some((f) => /manage\.py$/.test(f.path)) },
  { name: 'Flask', test: (deps) => 'flask' in deps },
  { name: 'Spring', test: (_deps, files) => files.some((f) => /pom\.xml$/.test(f.path)) },
  { name: 'Vite', test: (deps) => 'vite' in deps },
];

const TODO_PATTERN = /\b(TODO|FIXME|HACK|XXX)\b/g;
const DEBUG_PATTERNS = [
  /console\.(log|debug|warn)\s*\(/g, // JS
  /\bprint\s*\(/g, // Python (best-effort; noisy but conservative in aggregate)
  /\bdebugger\b/g,
];

// Conservative secret-shaped patterns. Intentionally narrow to minimize false
// positives — this flags *possible* secrets for human review, it does not
// claim certainty, and it never logs or persists the matched value itself.
const SECRET_PATTERNS = [
  { label: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/ },
  { label: 'Generic API key assignment', regex: /(api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*['"][a-zA-Z0-9_-]{16,}['"]/i },
  { label: 'Private key block', regex: /-----BEGIN (RSA|EC|DSA|OPENSSH|PGP) PRIVATE KEY-----/ },
  { label: 'Slack token', regex: /xox[baprs]-[0-9a-zA-Z-]{10,}/ },
];

function detectLanguages(files) {
  const counts = {};
  for (const file of files) {
    const ext = file.path.split('.').pop().toLowerCase();
    const lang = LANGUAGE_BY_EXT[ext];
    if (lang) counts[lang] = (counts[lang] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([language, fileCount]) => ({ language, fileCount }));
}

function parsePackageJson(files) {
  const pkgFile = files.find((f) => /(^|\/)package\.json$/.test(f.path));
  if (!pkgFile) return null;
  try {
    return JSON.parse(pkgFile.content);
  } catch {
    return null;
  }
}

function parseRequirementsTxt(files) {
  const reqFile = files.find((f) => /(^|\/)requirements\.txt$/.test(f.path));
  if (!reqFile) return null;
  return reqFile.content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function detectDependencies(files) {
  const pkg = parsePackageJson(files);
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const pyDeps = parseRequirementsTxt(files);

  return {
    ecosystem: pkg ? 'npm' : pyDeps ? 'pip' : null,
    dependencyCount: Object.keys(deps).length,
    devDependencyCount: Object.keys(pkg?.devDependencies || {}).length,
    pythonDependencyCount: pyDeps?.length || 0,
    npmDeps: deps,
  };
}

function detectFrameworks(files, npmDeps) {
  return FRAMEWORK_SIGNATURES.filter((sig) => sig.test(npmDeps, files)).map((sig) => sig.name);
}

function detectTestPresence(files) {
  const testFiles = files.filter((f) =>
    /(\.|_)test\.[jt]sx?$/.test(f.path) ||
    /(\.|_)spec\.[jt]sx?$/.test(f.path) ||
    /(^|\/)(tests?|__tests__)\//.test(f.path) ||
    /test_.*\.py$/.test(f.path)
  );
  return { hasTests: testFiles.length > 0, testFileCount: testFiles.length };
}

function detectDocumentation(files) {
  const readme = files.find((f) => /^readme\.md$/i.test(f.path.split('/').pop()));
  return {
    hasReadme: Boolean(readme),
    readmeLength: readme ? readme.content.length : 0,
    hasContributing: files.some((f) => /^contributing\.md$/i.test(f.path.split('/').pop())),
    hasLicense: files.some((f) => /^license(\.md|\.txt)?$/i.test(f.path.split('/').pop())),
  };
}

function detectCI(files) {
  const ciFiles = files.filter((f) =>
    /^\.github\/workflows\/.+\.ya?ml$/.test(f.path) ||
    /^\.gitlab-ci\.ya?ml$/.test(f.path) ||
    /^\.circleci\/config\.ya?ml$/.test(f.path) ||
    /^Jenkinsfile$/.test(f.path)
  );
  return { hasCI: ciFiles.length > 0, ciFiles: ciFiles.map((f) => f.path) };
}

function detectDocker(files) {
  const dockerfiles = files.filter((f) => /(^|\/)Dockerfile$/.test(f.path));
  const compose = files.filter((f) => /(^|\/)docker-compose\.ya?ml$/.test(f.path));
  return { hasDocker: dockerfiles.length > 0, hasDockerCompose: compose.length > 0 };
}

function detectLargeFiles(files) {
  const LARGE_FILE_THRESHOLD = 50 * 1024; // 50KB of source in one file is a maintainability smell
  return files
    .filter((f) => (f.content?.length || 0) > LARGE_FILE_THRESHOLD)
    .map((f) => ({ path: f.path, sizeBytes: f.content.length }))
    .sort((a, b) => b.sizeBytes - a.sizeBytes);
}

function countMatches(content, regex) {
  const matches = content.match(regex);
  return matches ? matches.length : 0;
}

function detectTodoDensity(files) {
  let totalTodos = 0;
  let totalLines = 0;
  for (const file of files) {
    totalTodos += countMatches(file.content, TODO_PATTERN);
    totalLines += (file.content.match(/\n/g)?.length || 0) + 1;
  }
  return {
    totalTodos,
    totalLines,
    todosPer1000Lines: totalLines > 0 ? Number(((totalTodos / totalLines) * 1000).toFixed(2)) : 0,
  };
}

function detectDebugStatements(files) {
  let total = 0;
  const byFile = [];
  for (const file of files) {
    let fileCount = 0;
    for (const pattern of DEBUG_PATTERNS) {
      fileCount += countMatches(file.content, pattern);
    }
    if (fileCount > 0) {
      total += fileCount;
      byFile.push({ path: file.path, count: fileCount });
    }
  }
  return { totalDebugStatements: total, filesWithDebugStatements: byFile.length };
}

// Conservative: only flags a match, never includes the matched substring in
// the output, so a real secret is never echoed back into logs, the DB, or
// the AI prompt.
function detectPossibleSecrets(files) {
  const findings = [];
  for (const file of files) {
    for (const { label, regex } of SECRET_PATTERNS) {
      if (regex.test(file.content)) {
        findings.push({ path: file.path, type: label });
      }
    }
  }
  return { possibleSecretsFound: findings.length > 0, count: findings.length, locations: findings };
}

// Runs the full deterministic pass over a project's files and returns a
// single structured summary object. This is the object persisted alongside
// the diagnosis and fed into both scoring.js and the AI prompt builder.
function analyzeProject(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('analyzeProject requires a non-empty file array');
  }

  const deps = detectDependencies(files);

  return {
    fileCount: files.length,
    totalSizeBytes: files.reduce((sum, f) => sum + (f.content?.length || 0), 0),
    languages: detectLanguages(files),
    frameworks: detectFrameworks(files, deps.npmDeps),
    dependencies: {
      ecosystem: deps.ecosystem,
      dependencyCount: deps.dependencyCount,
      devDependencyCount: deps.devDependencyCount,
      pythonDependencyCount: deps.pythonDependencyCount,
    },
    testing: detectTestPresence(files),
    documentation: detectDocumentation(files),
    ci: detectCI(files),
    docker: detectDocker(files),
    largeFiles: detectLargeFiles(files),
    todos: detectTodoDensity(files),
    debugStatements: detectDebugStatements(files),
    possibleSecrets: detectPossibleSecrets(files),
  };
}

module.exports = {
  analyzeProject,
  detectLanguages,
  detectFrameworks,
  detectDependencies,
  detectTestPresence,
  detectDocumentation,
  detectCI,
  detectDocker,
  detectLargeFiles,
  detectTodoDensity,
  detectDebugStatements,
  detectPossibleSecrets,
};
