const router = require('express').Router();
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/superadminUser.controller');

// Manajemen akun untuk SUPERADMIN/ADMIN, dan KOMPER yang menjadi PIC. Dibatasi
// mengelola role non-privileged saja (lihat MANAGEABLE_ROLES di controller).
const requireManager = async (req, res, next) => {
  try {
    const role = req.user.role;
    if (role === 'SUPERADMIN' || role === 'ADMIN') return next();
    if (role === 'KOMPER') {
      const u = await prisma.user.findUnique({ where: { id: req.user.id }, select: { isKomperPic: true } });
      if (u?.isKomperPic) return next();
    }
    return res.status(403).json({ error: 'Akses ditolak' });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal verifikasi akses', detail: error.message });
  }
};

router.use(authenticate, requireManager);

router.get('/roles', ctrl.getRoles);
router.get('/', ctrl.listUsers);
router.post('/', ctrl.createUser);
router.put('/:id', ctrl.updateUser);
router.delete('/:id', ctrl.deleteUser);

module.exports = router;
