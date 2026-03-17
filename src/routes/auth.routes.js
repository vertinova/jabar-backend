const router = require('express').Router();
const { register, login, getProfile, updateProfile, getUserDashboard, getKta, generateSsoToken, validateSsoToken } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.post('/register', register);
router.post('/login', login);
router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, updateProfile);
router.get('/user-dashboard', authenticate, getUserDashboard);
router.get('/kta', authenticate, getKta);

// SSO cross-domain auth
router.post('/sso-token', authenticate, generateSsoToken);
router.post('/sso-validate', validateSsoToken);

module.exports = router;
