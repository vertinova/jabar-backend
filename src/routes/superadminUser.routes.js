const router = require('express').Router();
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/superadminUser.controller');
const { isSuperRole } = require('../lib/roles');

// Manajemen akun untuk SUPERADMIN/ADMIN, dan KOMPER yang menjadi PIC. Dibatasi
// mengelola role non-privileged saja (lihat MANAGEABLE_ROLES di controller).
const requireManager = async (req, res, next) => {
  try {
    const role = req.user.role;
    if (isSuperRole(role) || role === 'ADMIN') return next();
    if (role === 'KOMPER') {
      const u = await prisma.user.findUnique({ where: { id: req.user.id }, select: { isKomperPic: true } });
      if (u?.isKomperPic) return next();
    }
    return res.status(403).json({ error: 'Akses ditolak' });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal verifikasi akses', detail: error.message });
  }
};

// Panel "Semua Pengguna" jauh lebih sensitif (lihat semua akun + reset password),
// jadi hanya SUPERADMIN/ADMIN — PIC KOMPER tidak boleh masuk ke sini.
const requireAdminLevel = (req, res, next) => {
  if (isSuperRole(req.user.role) || req.user.role === 'ADMIN') return next();
  return res.status(403).json({ error: 'Akses ditolak' });
};

const requireSuperLevel = (req, res, next) => {
  if (isSuperRole(req.user.role)) return next();
  return res.status(403).json({ error: 'Hanya Super Admin yang dapat melakukan aksi ini' });
};

router.use(authenticate, requireManager);

router.get('/all', requireAdminLevel, ctrl.listAllUsers);
router.post('/all/:id/reset-password', requireAdminLevel, ctrl.resetUserPassword);
// Masuk sebagai pengguna lain dibatasi SUPERADMIN/DEVELOPER saja — ADMIN biasa
// tidak ikut, karena fitur ini menerbitkan sesi atas nama orang lain.
router.post('/all/:id/impersonate', requireSuperLevel, ctrl.impersonateUser);

router.get('/roles', ctrl.getRoles);
router.get('/', ctrl.listUsers);
router.post('/', ctrl.createUser);
router.put('/:id', ctrl.updateUser);
router.delete('/:id', ctrl.deleteUser);

module.exports = router;
