const ApiError = require('../../utils/ApiError');
const { env } = require('../../config/env');
const logger = require('../../config/logger');

const CODE_EXTENSIONS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'go', 'rb', 'php', 'c', 'cpp', 'h', 'hpp',
  'cs', 'json', 'md', 'yml', 'yaml', 'html', 'css', 'scss', 'sql', 'sh',
]);

function parseGithubUrl(repoUrl) {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (!match) {
    throw ApiError.badRequest('Only public GitHub repository URLs are supported (https://github.com/owner/repo)');
  }
  return { owner: match[1], repo: match[2] };
}

async function githubFetch(url) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'project-doctor-ai',
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });

  if (res.status === 403) {
    throw ApiError.badRequest('GitHub API rate limit reached. Try again later or set GITHUB_TOKEN.');
  }
  if (res.status === 404) {
    throw ApiError.badRequest('Repository not found or is private.');
  }
  if (!res.ok) {
    throw ApiError.badRequest(`GitHub API error: ${res.status}`);
  }
  return res.json();
}

// Fetches up to MAX_UPLOAD_FILES source files (skipping binaries, lockfiles,
// vendored/build directories) from a public GitHub repo's default branch,
// via the GitHub REST API — no cloning, no shell-out to git required.
async function ingestGithubRepo(repoUrl) {
  const { owner, repo } = parseGithubUrl(repoUrl);

  const repoMeta = await githubFetch(`https://api.github.com/repos/${owner}/${repo}`);
  const defaultBranch = repoMeta.default_branch || 'main';

  const tree = await githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`
  );

  const candidates = (tree.tree || [])
    .filter((entry) => entry.type === 'blob')
    .filter((entry) => {
      const ext = entry.path.split('.').pop().toLowerCase();
      const isVendored = /(^|\/)(node_modules|dist|build|vendor|\.git)\//.test(entry.path);
      return CODE_EXTENSIONS.has(ext) && !isVendored && entry.size < env.MAX_FILE_SIZE_BYTES;
    })
    .slice(0, env.MAX_UPLOAD_FILES);

  if (candidates.length === 0) {
    throw ApiError.badRequest('No analyzable source files found in this repository.');
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
      });
    } catch (err) {
      logger.warn(`Skipping file ${entry.path}: ${err.message}`);
    }
  }

  if (files.length === 0) {
    throw ApiError.internal('Failed to fetch any file contents from the repository.');
  }

  return files;
}

module.exports = { ingestGithubRepo, parseGithubUrl };
