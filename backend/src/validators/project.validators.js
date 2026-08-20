const Joi = require('joi');

const fileSchema = Joi.object({
  path: Joi.string().trim().min(1).max(500).required(),
  language: Joi.string().trim().max(50).default('plaintext'),
  content: Joi.string().max(300 * 1024).required(), // 300KB cap per file
});

const createProjectSchema = Joi.object({
  name: Joi.string().trim().min(2).max(150).required(),
  description: Joi.string().trim().max(2000).allow('').default(''),
  sourceType: Joi.string().valid('upload', 'paste', 'repo_url').required(),
  repoUrl: Joi.string().uri().when('sourceType', {
    is: 'repo_url',
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  files: Joi.array().items(fileSchema).min(1).max(40).required(),
});

module.exports = { createProjectSchema };
