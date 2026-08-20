const express = require('express');
const {
  runDiagnosis,
  listDiagnosesForProject,
} = require('../controllers/diagnosis.controller');
const { diagnosisLimiter } = require('../middleware/rateLimit.middleware');

// mergeParams lets this router read :projectId from the parent router.
const router = express.Router({ mergeParams: true });

router.post('/', diagnosisLimiter, runDiagnosis);
router.get('/', listDiagnosesForProject);

module.exports = router;
