const ApiError = require('../../utils/ApiError');
const { env } = require('../../config/env');

const CODE_EXTENSIONS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'go', 'rb', 'php', 'c', 'cpp', 'h', 'hpp',
  'cs', 'json', 'md', 'yml', 'yaml', 'html', 'css', 'scss', 'sql', 'sh',
]);

// Normalizes a client-supplied filename into a safe, relative, display-only
// path: strips directory traversal segments, leading slashes, and null
// bytes. This is defense-in-depth — uploaded content is never written to
// disk or executed, only stored as a string and shown back to the user —
// but a malicious filename should never be trusted as-is even for display.
function sanitizePath(rawPath) {
  const noNulls = String(rawPath).replace(/\0/g, '');
  const segments = noNulls
    .split(/[/\\]/)
    .map((seg) => seg.trim())
    .filter((seg) => seg && seg !== '.' && seg !== '..');
  const safe = segments.join('/').slice(0, 500);
  return safe || 'unnamed-file';
}

// Converts multer's in-memory file buffers into the same { path, language,
// content } shape used by pasted code and GitHub ingestion, so the analysis
// pipeline never needs to know which source a project came from. Files are
// read from their in-memory buffer only (memory storage — never written to
// disk, never executed).
function normalizeUploadedFiles(multerFiles) {
  const accepted = [];
  const skipped = [];

  for (const file of multerFiles) {
    const safePath = sanitizePath(file.originalname);
    const ext = (safePath.split('.').pop() || '').toLowerCase();

    if (!CODE_EXTENSIONS.has(ext)) {
      skipped.push({ path: safePath, reason: 'unsupported file type' });
      continue;
    }
    if (file.size > env.MAX_FILE_SIZE_BYTES) {
      skipped.push({ path: safePath, reason: 'file too large' });
      continue;
    }

    accepted.push({
      path: safePath,
      language: ext,
      content: file.buffer.toString('utf-8').slice(0, env.MAX_FILE_SIZE_BYTES),
    });
  }

  if (accepted.length === 0) {
    throw ApiError.badRequest('None of the uploaded files were analyzable (unsupported type or too large).');
  }

  return accepted;
}

module.exports = { normalizeUploadedFiles, CODE_EXTENSIONS };
