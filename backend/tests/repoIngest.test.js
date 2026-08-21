process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.GEMINI_API_KEY = 'test-key';

const { ingestGithubRepo, parseGithubUrl } = require('../src/services/project/repoIngest');
const ApiError = require('../src/utils/ApiError');

describe('parseGithubUrl', () => {
  it('parses a standard repo URL', () => {
    expect(parseGithubUrl('https://github.com/owner/repo')).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('strips a trailing .git suffix', () => {
    expect(parseGithubUrl('https://github.com/owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('rejects a non-github host', () => {
    expect(() => parseGithubUrl('https://gitlab.com/owner/repo')).toThrow(ApiError);
  });

  it('rejects a non-https URL', () => {
    expect(() => parseGithubUrl('http://github.com/owner/repo')).toThrow(ApiError);
  });

  it('rejects a malformed URL', () => {
    expect(() => parseGithubUrl('not a url')).toThrow(ApiError);
  });

  it('rejects a URL missing the repo segment', () => {
    expect(() => parseGithubUrl('https://github.com/owner')).toThrow(ApiError);
  });

  it('rejects an empty or oversized input', () => {
    expect(() => parseGithubUrl('')).toThrow(ApiError);
    expect(() => parseGithubUrl('https://github.com/' + 'a'.repeat(400))).toThrow(ApiError);
  });
});

describe('ingestGithubRepo', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function mockFetchSequence(responses) {
    let call = 0;
    global.fetch = jest.fn(() => {
      const response = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return Promise.resolve(response);
    });
  }

  it('throws a clean error for a 404 (private or nonexistent repo)', async () => {
    mockFetchSequence([{ ok: false, status: 404, headers: new Map() }]);
    await expect(ingestGithubRepo('https://github.com/owner/repo')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws a 429 for exhausted rate limits', async () => {
    const headers = new Map([['x-ratelimit-remaining', '0'], ['x-ratelimit-reset', '9999999999']]);
    mockFetchSequence([{ ok: false, status: 403, headers: { get: (k) => headers.get(k) } }]);
    await expect(ingestGithubRepo('https://github.com/owner/repo')).rejects.toMatchObject({ statusCode: 429 });
  });

  it('throws a 403 for generic access-denied (non rate-limit) responses', async () => {
    const headers = { get: () => null };
    mockFetchSequence([{ ok: false, status: 403, headers }]);
    await expect(ingestGithubRepo('https://github.com/owner/repo')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('throws for an empty repository', async () => {
    mockFetchSequence([{ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ default_branch: 'main', size: 0 }) }]);
    await expect(ingestGithubRepo('https://github.com/owner/repo')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws when the tree is empty', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ default_branch: 'main', size: 10 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ tree: [] }) });

    await expect(ingestGithubRepo('https://github.com/owner/repo')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws on a network failure', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('network down')));
    await expect(ingestGithubRepo('https://github.com/owner/repo')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('retries once on a 5xx then succeeds', async () => {
    let repoCalls = 0;
    global.fetch = jest.fn((url) => {
      if (url.includes('/repos/owner/repo') && !url.includes('/git/trees')) {
        repoCalls += 1;
        if (repoCalls === 1) {
          return Promise.resolve({ ok: false, status: 502, headers: { get: () => null } });
        }
        return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve({ default_branch: 'main', size: 10 }) });
      }
      if (url.includes('/git/trees')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: () => Promise.resolve({ tree: [{ type: 'blob', path: 'index.js', size: 100 }] }),
        });
      }
      // raw content fetch
      return Promise.resolve({ ok: true, text: () => Promise.resolve('console.log(1);') });
    });

    const result = await ingestGithubRepo('https://github.com/owner/repo');
    expect(result.files.length).toBe(1);
    expect(repoCalls).toBe(2);
  });

  it('successfully ingests files and returns meta', async () => {
    global.fetch = jest.fn((url) => {
      if (url.includes('/git/trees')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: () =>
            Promise.resolve({
              tree: [
                { type: 'blob', path: 'index.js', size: 100 },
                { type: 'blob', path: 'node_modules/x/y.js', size: 100 },
                { type: 'blob', path: 'image.png', size: 100 },
              ],
            }),
        });
      }
      if (url.includes('/repos/owner/repo')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: () => Promise.resolve({ default_branch: 'main', size: 10 }),
        });
      }
      return Promise.resolve({ ok: true, text: () => Promise.resolve('console.log(1);') });
    });

    const result = await ingestGithubRepo('https://github.com/owner/repo');
    expect(result.files).toHaveLength(1); // node_modules and .png filtered out
    expect(result.files[0].path).toBe('index.js');
    expect(result.meta.owner).toBe('owner');
    expect(result.meta.repo).toBe('repo');
  });
});
