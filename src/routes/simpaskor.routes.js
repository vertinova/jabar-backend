const router = require('express').Router();
const { verifyBilling } = require('../controllers/simpaskor.controller');
const { authenticate } = require('../middleware/auth.middleware');

// Verify billing code — requires login
router.get('/verify', authenticate, verifyBilling);

module.exports = router;
