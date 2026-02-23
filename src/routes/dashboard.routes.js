const router = require('express').Router();
const { getStats, getLandingData, getAnggotaForbasi } = require('../controllers/dashboard.controller');
const { authenticate, isAdmin } = require('../middleware/auth.middleware');

// Public endpoints for landing page (no auth)
router.get('/landing', getLandingData);
router.get('/anggota', getAnggotaForbasi);

router.get('/stats', authenticate, isAdmin, getStats);

module.exports = router;
