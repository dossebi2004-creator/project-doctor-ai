const mongoose = require('mongoose');

const CATEGORIES = ['BUG', 'SECURITY', 'PERFORMANCE', 'ARCHITECTURE', 'CODE_QUALITY', 'TESTING', 'DOCUMENTATION', 'DEPENDENCY', 'DEVOPS'];
const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

const findingSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    category: { type: String, enum: CATEGORIES, required: true },
    severity: { type: String, enum: SEVERITIES, required: true },
    file: { type: String, default: null },
    description: { type: String, required: true },
    evidence: { type: String, default: '' },
    reasoning: { type: String, default: '' },
    recommendation: { type: String, required: true },
    estimatedImpact: { type: String, default: '' },
  },
  { _id: false }
);

const dimensionScoreSchema = new mongoose.Schema(
  {
    score: { type: Number, min: 0, max: 100, required: true },
    reasons: { type: [String], default: [] },
  },
  { _id: false }
);

const actionPlanItemSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    category: { type: String, enum: CATEGORIES, required: true },
    severity: { type: String, enum: SEVERITIES, required: true },
    recommendation: { type: String, required: true },
    file: { type: String, default: null },
  },
  { _id: false }
);

const analysisSnapshotSchema = new mongoose.Schema({}, { _id: false, strict: false });

const diagnosisSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['completed', 'deterministic_only', 'failed'],
      default: 'completed',
    },
    healthScore: {
      type: Number,
      min: 0,
      max: 100,
      required: true,
    },
    dimensionScores: {
      testing: dimensionScoreSchema,
      documentation: dimensionScoreSchema,
      security: dimensionScoreSchema,
      maintainability: dimensionScoreSchema,
      devops: dimensionScoreSchema,
      architecture: dimensionScoreSchema,
    },
    findings: {
      type: [findingSchema],
      default: [],
    },
    actionPlan: {
      P0: { type: [actionPlanItemSchema], default: [] },
      P1: { type: [actionPlanItemSchema], default: [] },
      P2: { type: [actionPlanItemSchema], default: [] },
      P3: { type: [actionPlanItemSchema], default: [] },
    },
    analysisSnapshot: {
      // Deterministic analyzer output at diagnosis time, kept for audit/debugging.
      type: analysisSnapshotSchema,
      default: null,
    },
    modelUsed: {
      type: String,
      required: true,
    },
    errorMessage: {
      // Populated when status === 'failed' or 'deterministic_only'
      type: String,
      default: null,
    },
    aiSucceeded: {
      type: Boolean,
      default: true,
    },
    rawModelResponseTruncated: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Diagnosis', diagnosisSchema);
module.exports.CATEGORIES = CATEGORIES;
module.exports.SEVERITIES = SEVERITIES;
