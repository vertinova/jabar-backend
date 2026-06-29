const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/superadminUser.controller');

// Manajemen akun untuk SUPERADMIN (dan ADMIN). Dibatasi mengelola role non-privileged
// saja (lihat MANAGEABLE_ROLES di controller).
const requireManager = (req, res, next) => {
  if (!['SUPERADMIN', 'ADMIN'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }
  next();
};

router.use(authenticate, requireManager);

router.get('/roles', ctrl.getRoles);
router.get('/', ctrl.listUsers);
router.post('/', ctrl.createUser);
router.put('/:id', ctrl.updateUser);
router.delete('/:id', ctrl.deleteUser);

module.exports = router;
