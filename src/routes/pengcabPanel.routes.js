const express = require('express');
const router = express.Router();
const { authenticate, isPengcab } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/pengcabPanel.controller');
const upload = require('../middleware/upload.middleware');

// Wrap multer to catch file upload errors
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

router.use(authenticate, isPengcab);

router.get('/dashboard', ctrl.getDashboard);
router.get('/rekomendasi', ctrl.getRekomendasi);
router.put('/rekomendasi/:id/approve', ctrl.approveRekomendasi);
router.put('/rekomendasi/:id/reject', ctrl.rejectRekomendasi);
router.get('/pendaftaran', ctrl.getPendaftaran);
router.get('/anggota', ctrl.getAnggota);
router.put('/anggota/:id', ctrl.updateAnggota);
router.get('/kejurcab', ctrl.getKejurcab);
router.post('/kejurcab', handleUpload, ctrl.createKejurcab);

module.exports = router;
