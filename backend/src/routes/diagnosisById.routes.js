const express = require('express');
const { getDiagnosis, exportDiagnosisPdf } = require('../controllers/diagnosis.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/:id', requireAuth, getDiagnosis);
router.get('/:id/export/pdf', requireAuth, exportDiagnosisPdf);

module.exports = router;
