const router = require('express').Router();
const { getAll, getById, create, update, updateJadwal, updateStatus, remove, regenerateSurat } = require('../controllers/rekomendasi.controller');
const { authenticate, isAdmin, isPengcab } = require('../middleware/auth.middleware');

// Middleware: allow ADMIN or PENGCAB
const isAdminOrPengcab = (req, res, next) => {
  if (req.user.role === 'ADMIN' || req.user.role === 'PENGCAB') return next();
  return res.status(403).json({ error: 'Akses ditolak. Hanya admin atau pengcab yang bisa mengakses.' });
};
const upload = require('../middleware/upload.middleware');

// Wrap multer to catch file upload errors (size limit, invalid type, etc.)
const handleUpload = (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err) {
      console.error('Multer upload error:', err.message);
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'Ukuran file terlalu besar. Maksimal 10MB per file.'
        : err.message || 'Gagal upload file';
      return res.status(400).json({ error: msg });
    }
    next();
  });
};

router.get('/', authenticate, getAll);
router.get('/:id', authenticate, getById);
router.post('/', authenticate, handleUpload, create);
router.put('/:id', authenticate, handleUpload, update);
// Tanggal pelaksanaan saja — tidak menyentuh status persetujuan, jadi tidak
// lewat `update` yang mengembalikan event ke PENDING.
router.patch('/:id/jadwal', authenticate, updateJadwal);
router.patch('/:id/status', authenticate, isAdminOrPengcab, updateStatus);
router.post('/:id/regenerate-surat', authenticate, isAdmin, regenerateSurat);
router.delete('/:id', authenticate, remove);

module.exports = router;
