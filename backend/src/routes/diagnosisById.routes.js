const express = require('express');
const { getDiagnosis } = require('../controllers/diagnosis.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/:id', requireAuth, getDiagnosis);

module.exports = router;
