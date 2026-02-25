const router = require('express').Router();
const { getAll, getById, create, updateStatus, remove, uploadPelunasan, verifyPelunasan, rejectPelunasan, verifyQr } = require('../controllers/pendaftaran.controller');
const { authenticate, isAdmin } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');

// Wrap multer to catch file upload errors gracefully
const wrapUpload = (multerFn) => (req, res, next) => {
  multerFn(req, res, (err) => {
    if (err) {
      console.error('Multer upload error:', err.message);
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'Ukuran file terlalu besar. Maksimal 5MB per file.'
        : err.message || 'Gagal upload file';
      return res.status(400).json({ error: msg });
    }
    next();
  });
};

router.get('/verify-qr/:token', authenticate, verifyQr);
router.get('/', authenticate, getAll);
router.get('/:id', authenticate, getById);
router.post('/', authenticate, wrapUpload(upload.fields([
  { name: 'buktiPembayaran', maxCount: 1 },
  { name: 'buktiDP', maxCount: 1 },
  { name: 'dokumen', maxCount: 1 }
])), create);
router.patch('/:id/status', authenticate, isAdmin, updateStatus);
router.patch('/:id/pelunasan', authenticate, wrapUpload(upload.fields([
  { name: 'buktiPelunasan', maxCount: 1 }
])), uploadPelunasan);
router.patch('/:id/verify-pelunasan', authenticate, isAdmin, verifyPelunasan);
router.patch('/:id/reject-pelunasan', authenticate, isAdmin, rejectPelunasan);
router.delete('/:id', authenticate, remove);

module.exports = router;
