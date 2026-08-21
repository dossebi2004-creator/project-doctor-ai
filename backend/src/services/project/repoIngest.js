const ApiError = require('../../utils/ApiError');
const { env } = require('../../config/env');
const logger = require('../../config/logger');

const CODE_EXTENSIONS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'go', 'rb', 'php', 'c', 'cpp', 'h', 'hpp',
  'cs', 'json', 'md', 'yml', 'yaml', 'html', 'css', 'scss', 'sql', 'sh',
]);

// Strict GitHub URL validation: only https://github.com/<owner>/<repo>(.git)?(/)?
// Rejects query strings, extra path segments, non-github hosts, and non-http(s) schemes.
function parseGithubUrl(repoUrl) {
  if (typeof repoUrl !== 'string' || repoUrl.length === 0 || repoUrl.length > 300) {
    throw ApiError.badRequest('Repository URL is required.');
  }

  let parsed;
  try {
    parsed = new URL(repoUrl);
  } catch {
    throw ApiError.badRequest('That is not a valid URL.');
  }

  if (parsed.protocol !== 'https:') {
    throw ApiError.badRequest('Only https:// GitHub URLs are supported.');
  }
  if (parsed.hostname.toLowerCase() !== 'github.com') {
    throw ApiError.badRequest('Only public GitHub repository URLs are supported (https://github.com/owner/repo).');
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw ApiError.badRequest('URL must point to a repository: https://github.com/owner/repo');
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, '');

  if (!/^[a-zA-Z0-9-_.]+$/.test(owner) || !/^[a-zA-Z0-9-_.]+$/.test(repo)) {
    throw ApiError.badRequest('Repository owner/name contains invalid characters.');
  }

  return { owner, repo };
}

// Central fetch wrapper for the GitHub REST API. Distinguishes the specific
// failure modes callers need to react to differently (private/missing repo,
// rate limiting, transient GitHub outages, network failure).
async function githubFetch(url, { retries = 1 } = {}) {
  let res;
  try {
    res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'project-doctor-ai',
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
    });
  } catch (err) {
    logger.error(`GitHub network failure for ${url}: ${err.message}`);
    throw ApiError.badRequest('Could not reach GitHub. Check your connection and try again.');
  }

  if (res.status === 404) {
    throw ApiError.badRequest('Repository not found. It may be private, renamed, or deleted.');
  }

  if (res.status === 403) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining === '0') {
      const resetHeader = res.headers.get('x-ratelimit-reset');
      const resetAt = resetHeader ? new Date(Number(resetHeader) * 1000).toLocaleTimeString() : 'later';
      throw ApiError.tooManyRequests(
        `GitHub API rate limit reached. Try again after ${resetAt}, or configure GITHUB_TOKEN for higher limits.`
      );
    }
    throw ApiError.forbidden('GitHub denied access to this repository (it may be private).');
  }

  if (res.status === 401) {
    throw ApiError.internal('GitHub authentication failed. Check the configured GITHUB_TOKEN.');
  }

  if (res.status >= 500 && retries > 0) {
    logger.warn(`GitHub returned ${res.status} for ${url}, retrying once`);
    await new Promise((r) => setTimeout(r, 500));
    return githubFetch(url, { retries: retries - 1 });
  }

  if (res.status >= 500) {
    throw ApiError.internal('GitHub is currently unavailable. Please try again shortly.');
  }

  if (!res.ok) {
    throw ApiError.badRequest(`GitHub API error (${res.status}). Please check the repository URL.`);
  }

  return res.json();
}

function isVendoredPath(path) {
  return /(^|\/)(node_modules|dist|build|vendor|\.git|coverage|\.next|target)\//.test(path);
}

// Fetches up to MAX_UPLOAD_FILES source files (skipping binaries, lockfiles,
// vendored/build directories) from a public GitHub repo's default branch,
// via the GitHub REST API — no cloning, no shell-out to git required.
async function ingestGithubRepo(repoUrl) {
  const { owner, repo } = parseGithubUrl(repoUrl);

  const repoMeta = await githubFetch(`https://api.github.com/repos/${owner}/${repo}`);

  if (repoMeta.private) {
    // Defensive: normally 404s before this point when using an unauthenticated
    // token, but a configured GITHUB_TOKEN with access could reach here.
    throw ApiError.badRequest('Private repositories are not supported.');
  }

  if (typeof repoMeta.size === 'number' && repoMeta.size === 0) {
    throw ApiError.badRequest('This repository is empty — nothing to analyze.');
  }

  const defaultBranch = repoMeta.default_branch || 'main';

  const tree = await githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`
  );

  if (!Array.isArray(tree.tree) || tree.tree.length === 0) {
    throw ApiError.badRequest('This repository has no files to analyze.');
  }

  if (tree.truncated) {
    logger.warn(`Tree for ${owner}/${repo} was truncated by GitHub; analysis will be partial.`);
  }

  const allBlobs = tree.tree.filter((entry) => entry.type === 'blob');

  const candidates = allBlobs
    .filter((entry) => {
      const ext = entry.path.split('.').pop().toLowerCase();
      return CODE_EXTENSIONS.has(ext) && !isVendoredPath(entry.path) && entry.size < env.MAX_FILE_SIZE_BYTES;
    })
    .slice(0, env.MAX_UPLOAD_FILES);

  if (candidates.length === 0) {
    throw ApiError.badRequest('No analyzable source files found in this repository (only binaries, vendored code, or unsupported file types).');
  }

  const files = [];
  for (const entry of candidates) {
    try {
      const raw = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}/${entry.path}`
      );
      if (!raw.ok) continue;
      const content = await raw.text();
      files.push({
        path: entry.path,
        language: entry.path.split('.').pop(),
        content: content.slice(0, env.MAX_FILE_SIZE_BYTES),
        sizeBytes: entry.size,
      });
    } catch (err) {
      logger.warn(`Skipping file ${entry.path}: ${err.message}`);
    }
  }

  if (files.length === 0) {
    throw ApiError.internal('Failed to fetch any file contents from the repository. Please try again.');
  }

  return {
    files,
    meta: {
      owner,
      repo,
      defaultBranch,
      totalFilesInRepo: allBlobs.length,
      filesAnalyzed: files.length,
      truncatedTree: Boolean(tree.truncated),
    },
  };
}

module.exports = { ingestGithubRepo, parseGithubUrl };
