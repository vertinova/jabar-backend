const router = require('express').Router();
const { getStats, getLandingData, getAnggotaForbasi, clearAnggotaCache } = require('../controllers/dashboard.controller');
const { authenticate, isAdmin } = require('../middleware/auth.middleware');

// Public endpoints for landing page (no auth)
router.get('/landing', getLandingData);
router.get('/anggota', getAnggotaForbasi);

// Admin endpoints
router.get('/stats', authenticate, isAdmin, getStats);
router.post('/anggota/refresh', authenticate, isAdmin, clearAnggotaCache);

module.exports = router;
