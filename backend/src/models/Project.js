const mongoose = require('mongoose');

// A single source file submitted as part of a project for analysis.
// Content is capped and stripped of nothing sensitive — the client is
// responsible for not uploading secrets; we just never log file bodies.
const fileSchema = new mongoose.Schema(
  {
    path: { type: String, required: true, trim: true },
    language: { type: String, trim: true, default: 'plaintext' },
    content: { type: String, required: true },
  },
  { _id: false }
);

const projectSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Project name is required'],
      trim: true,
      maxlength: 150,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },
    sourceType: {
      type: String,
      enum: ['upload', 'paste', 'repo_url'],
      required: true,
    },
    repoUrl: {
      type: String,
      trim: true,
      default: null,
    },
    repoMeta: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    files: {
      type: [fileSchema],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'A project must contain at least one file',
      },
    },
    status: {
      type: String,
      enum: ['pending', 'analyzing', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Project', projectSchema);
