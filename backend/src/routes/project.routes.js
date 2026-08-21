const express = require('express');
const {
  createProject,
  uploadProject,
  listProjects,
  getProject,
  deleteProject,
} = require('../controllers/project.controller');
const validate = require('../middleware/validate.middleware');
const { createProjectSchema } = require('../validators/project.validators');
const { requireAuth } = require('../middleware/auth.middleware');
const { uploadFiles } = require('../middleware/upload.middleware');
const diagnosisRouter = require('./diagnosis.routes');

const router = express.Router();

router.use(requireAuth);

router.post('/', validate(createProjectSchema), createProject);
router.post('/upload', uploadFiles, uploadProject);
router.get('/', listProjects);
router.get('/:id', getProject);
router.delete('/:id', deleteProject);

// Nested: /api/projects/:projectId/diagnoses
router.use('/:projectId/diagnoses', diagnosisRouter);

module.exports = router;
