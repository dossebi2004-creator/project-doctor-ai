const Project = require('../models/Project');
const Diagnosis = require('../models/Diagnosis');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { diagnoseProject } = require('../services/ai/diagnosisAgent');
const { generateDiagnosisPdf } = require('../services/report/pdfReport');
const logger = require('../config/logger');

// Runs the AI diagnosis agent against a project the user owns, persists the
// report, and updates the project's status. Distinguishes three failure
// modes so the client always knows exactly what happened:
//   1. Conflict — a diagnosis is already running for this project (409)
//   2. AI failure — the analysis pipeline itself failed (project -> 'failed')
//   3. Persistence failure — analysis succeeded but saving it to the DB
//      failed (project left 'analyzing' is wrong; we still mark 'failed'
//      so the user isn't stuck looking at a report that was never saved)
const runDiagnosis = asyncHandler(async (req, res) => {
  const project = await Project.findOne({ _id: req.params.projectId, owner: req.user._id });
  if (!project) throw ApiError.notFound('Project not found');

  if (project.status === 'analyzing') {
    throw ApiError.conflict('A diagnosis is already running for this project. Please wait for it to finish.');
  }

  // Atomically claim the 'analyzing' lock so two concurrent requests for the
  // same project can't both start an analysis.
  const claimed = await Project.findOneAndUpdate(
    { _id: project._id, owner: req.user._id, status: { $ne: 'analyzing' } },
    { $set: { status: 'analyzing' } },
    { new: true }
  );
  if (!claimed) {
    throw ApiError.conflict('A diagnosis is already running for this project. Please wait for it to finish.');
  }

  let result;
  try {
    result = await diagnoseProject({
      projectName: project.name,
      description: project.description,
      files: project.files,
    });
  } catch (err) {
    // diagnoseProject() itself only throws for failures before/outside the AI
    // step (e.g. the analyzer rejecting an empty file list) — AI failures are
    // caught internally and returned as a deterministic-only result instead.
    logger.error(`Diagnosis pipeline failed for project ${project._id}: ${err.message}`);
    await Project.updateOne({ _id: project._id }, { $set: { status: 'failed' } });
    await Diagnosis.create({
      project: project._id,
      owner: req.user._id,
      status: 'failed',
      healthScore: 0,
      dimensionScores: {},
      findings: [],
      actionPlan: { P0: [], P1: [], P2: [], P3: [] },
      modelUsed: 'n/a',
      aiSucceeded: false,
      errorMessage: err.message,
    }).catch((persistErr) => {
      // Best-effort audit trail — if even this fails, don't mask the original error.
      logger.error(`Failed to persist failed-diagnosis record: ${persistErr.message}`);
    });
    throw err; // preserve the original ApiError (rate limit / timeout / parse failure) for the client
  }

  let diagnosis;
  try {
    diagnosis = await Diagnosis.create({
      project: project._id,
      owner: req.user._id,
      status: result.aiSucceeded ? 'completed' : 'deterministic_only',
      healthScore: result.healthScore,
      dimensionScores: result.dimensionScores,
      findings: result.findings,
      actionPlan: result.actionPlan,
      analysisSnapshot: result.analysis,
      modelUsed: result.modelUsed,
      aiSucceeded: result.aiSucceeded,
      errorMessage: result.aiError,
      rawModelResponseTruncated: result.rawModelResponseTruncated,
    });
  } catch (err) {
    logger.error(`Failed to persist diagnosis for project ${project._id}: ${err.message}`);
    await Project.updateOne({ _id: project._id }, { $set: { status: 'failed' } });
    throw ApiError.internal('Analysis completed but the report could not be saved. Please retry.');
  }

  project.status = 'completed';
  await project.save();

  res.status(201).json({ success: true, data: { diagnosis } });
});

const getDiagnosis = asyncHandler(async (req, res) => {
  const diagnosis = await Diagnosis.findOne({ _id: req.params.id, owner: req.user._id }).populate(
    'project',
    'name description sourceType repoUrl status createdAt'
  );
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

// Streams a PDF export of an existing diagnosis. Generation failures (e.g.
// pdfkit throwing mid-stream) are caught and reported as a clean 500 rather
// than a hung or truncated download.
const exportDiagnosisPdf = asyncHandler(async (req, res) => {
  const diagnosis = await Diagnosis.findOne({ _id: req.params.id, owner: req.user._id });
  if (!diagnosis) throw ApiError.notFound('Diagnosis not found');
  if (diagnosis.status === 'failed') {
    throw ApiError.badRequest('Failed diagnoses cannot be exported.');
  }

  const project = await Project.findOne({ _id: diagnosis.project, owner: req.user._id }).select('-files.content');
  if (!project) throw ApiError.notFound('Associated project not found');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="diagnosis-${diagnosis._id}.pdf"`
  );

  try {
    generateDiagnosisPdf({ project, diagnosis }, res);
  } catch (err) {
    logger.error(`PDF generation failed for diagnosis ${diagnosis._id}: ${err.message}`);
    if (!res.headersSent) {
      throw ApiError.internal('Failed to generate PDF report. Please try again.');
    }
    res.end(); // headers already sent — best we can do is terminate the stream cleanly
  }
});

module.exports = { runDiagnosis, getDiagnosis, listDiagnosesForProject, exportDiagnosisPdf };
