const Project = require('../models/Project');
const Diagnosis = require('../models/Diagnosis');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { diagnoseProject } = require('../services/ai/diagnosisAgent');
const logger = require('../config/logger');

// Runs the AI diagnosis agent against a project the user owns, persists the
// report, and updates the project's status. If the AI call fails, the
// project is marked 'failed' rather than left stuck in 'analyzing'.
const runDiagnosis = asyncHandler(async (req, res) => {
  const project = await Project.findOne({ _id: req.params.projectId, owner: req.user._id });
  if (!project) throw ApiError.notFound('Project not found');

  project.status = 'analyzing';
  await project.save();

  let result;
  try {
    result = await diagnoseProject({
      projectName: project.name,
      description: project.description,
      files: project.files,
    });
  } catch (err) {
    project.status = 'failed';
    await project.save();
    logger.error(`Diagnosis failed for project ${project._id}: ${err.message}`);
    throw err;
  }

  const diagnosis = await Diagnosis.create({
    project: project._id,
    owner: req.user._id,
    ...result,
  });

  project.status = 'completed';
  await project.save();

  res.status(201).json({ success: true, data: { diagnosis } });
});

const getDiagnosis = asyncHandler(async (req, res) => {
  const diagnosis = await Diagnosis.findOne({ _id: req.params.id, owner: req.user._id });
  if (!diagnosis) throw ApiError.notFound('Diagnosis not found');

  res.status(200).json({ success: true, data: { diagnosis } });
});

const listDiagnosesForProject = asyncHandler(async (req, res) => {
  const diagnoses = await Diagnosis.find({
    project: req.params.projectId,
    owner: req.user._id,
  }).sort({ createdAt: -1 });

  res.status(200).json({ success: true, data: { diagnoses } });
});

module.exports = { runDiagnosis, getDiagnosis, listDiagnosesForProject };
