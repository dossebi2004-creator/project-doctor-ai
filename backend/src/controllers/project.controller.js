const Project = require('../models/Project');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ingestGithubRepo } = require('../services/project/repoIngest');
const { normalizeUploadedFiles } = require('../services/project/uploadIngest');

// Shared by all three source types (paste, repo_url, upload) so every
// project — regardless of how its files arrived — converges into the same
// Project document shape and downstream analysis/diagnosis pipeline.
async function persistProject({ owner, name, description, sourceType, repoUrl, files, repoMeta }) {
  return Project.create({
    owner,
    name,
    description,
    sourceType,
    repoUrl: sourceType === 'repo_url' ? repoUrl : null,
    files,
    repoMeta: repoMeta || null,
  });
}

const createProject = asyncHandler(async (req, res) => {
  const { name, description, sourceType, repoUrl, files } = req.body;

  let resolvedFiles = files;
  let repoMeta = null;

  if (sourceType === 'repo_url') {
    const ingestResult = await ingestGithubRepo(repoUrl);
    resolvedFiles = ingestResult.files;
    repoMeta = ingestResult.meta;
  }

  const project = await persistProject({
    owner: req.user._id,
    name,
    description,
    sourceType,
    repoUrl,
    files: resolvedFiles,
    repoMeta,
  });

  res.status(201).json({ success: true, data: { project } });
});

// Accepts multipart file uploads (multer memory storage — see
// middleware/upload.middleware.js) and routes them through the same
// analysis pipeline as pasted code or GitHub ingestion.
const uploadProject = asyncHandler(async (req, res) => {
  const { name, description } = req.body;

  if (!name || !name.trim()) {
    throw ApiError.badRequest('Project name is required.');
  }
  if (!req.files || req.files.length === 0) {
    throw ApiError.badRequest('At least one file must be uploaded.');
  }

  const files = normalizeUploadedFiles(req.files);

  const project = await persistProject({
    owner: req.user._id,
    name: name.trim(),
    description: (description || '').trim(),
    sourceType: 'upload',
    files,
  });

  res.status(201).json({ success: true, data: { project } });
});

const listProjects = asyncHandler(async (req, res) => {
  const projects = await Project.find({ owner: req.user._id })
    .select('-files.content') // don't ship full file bodies in list view
    .sort({ createdAt: -1 });

  res.status(200).json({ success: true, data: { projects } });
});

const getProject = asyncHandler(async (req, res) => {
  const project = await Project.findOne({ _id: req.params.id, owner: req.user._id });
  if (!project) throw ApiError.notFound('Project not found');

  res.status(200).json({ success: true, data: { project } });
});

const deleteProject = asyncHandler(async (req, res) => {
  const project = await Project.findOneAndDelete({ _id: req.params.id, owner: req.user._id });
  if (!project) throw ApiError.notFound('Project not found');

  res.status(200).json({ success: true, data: { deleted: true } });
});

module.exports = { createProject, uploadProject, listProjects, getProject, deleteProject };
