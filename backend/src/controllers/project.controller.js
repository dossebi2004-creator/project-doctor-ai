const Project = require('../models/Project');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ingestGithubRepo } = require('../services/project/repoIngest');

const createProject = asyncHandler(async (req, res) => {
  const { name, description, sourceType, repoUrl, files } = req.body;

  let resolvedFiles = files;
  if (sourceType === 'repo_url') {
    resolvedFiles = await ingestGithubRepo(repoUrl);
  }

  const project = await Project.create({
    owner: req.user._id,
    name,
    description,
    sourceType,
    repoUrl: sourceType === 'repo_url' ? repoUrl : null,
    files: resolvedFiles,
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

module.exports = { createProject, listProjects, getProject, deleteProject };
