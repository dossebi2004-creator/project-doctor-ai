const mongoose = require('mongoose');

const findingSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ['bug', 'security', 'performance', 'maintainability', 'architecture', 'testing', 'style'],
      required: true,
    },
    severity: {
      type: String,
      enum: ['critical', 'high', 'medium', 'low', 'info'],
      required: true,
    },
    file: { type: String, default: null },
    explanation: { type: String, required: true },
    recommendation: { type: String, required: true },
  },
  { _id: false }
);

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
    summary: {
      type: String,
      required: true,
    },
    healthScore: {
      type: Number,
      min: 0,
      max: 100,
      required: true,
    },
    findings: {
      type: [findingSchema],
      default: [],
    },
    modelUsed: {
      type: String,
      required: true,
    },
    rawModelResponseTruncated: {
      // Kept for debugging/audit purposes only, capped in length.
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Diagnosis', diagnosisSchema);
