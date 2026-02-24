const router = require('express').Router();
const { register, login, getProfile, updateProfile, getUserDashboard, getKta, googleAuth } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.post('/register', register);
router.post('/login', login);
router.post('/google', googleAuth);
router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, updateProfile);
router.get('/user-dashboard', authenticate, getUserDashboard);
router.get('/kta', authenticate, getKta);

module.exports = router;
