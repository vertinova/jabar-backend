const router = require('express').Router();
const { getAll, getById, create, update, updateStatus, remove } = require('../controllers/rekomendasi.controller');
const { authenticate, isAdmin } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');

// Wrap multer to catch file upload errors (size limit, invalid type, etc.)
const handleUpload = (req, res, next) => {
  upload.any()(req, res, (err) => {
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

router.get('/', authenticate, getAll);
router.get('/:id', authenticate, getById);
router.post('/', authenticate, handleUpload, create);
router.put('/:id', authenticate, handleUpload, update);
router.patch('/:id/status', authenticate, isAdmin, updateStatus);
router.delete('/:id', authenticate, remove);

module.exports = router;
