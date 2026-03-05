const express = require('express');
const router = express.Router();
const { authenticate, isAdmin } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/adminUser.controller');

router.use(authenticate, isAdmin);

// Stats & FORBASI routes (must be before /:id to avoid conflict)
router.get('/stats', ctrl.getUserStats);
router.get('/anggota-kta', ctrl.getAnggotaKta);
router.get('/forbasi-accounts', ctrl.getForbasiAccounts);
router.get('/forbasi-accounts/:id', ctrl.getForbasiAccountDetail);
router.post('/forbasi-reset-password', ctrl.resetForbasiPassword);

router.get('/', ctrl.getAllUsers);
router.get('/:id', ctrl.getUserById);
router.put('/:id', ctrl.updateUser);

module.exports = router;
