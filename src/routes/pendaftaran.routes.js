const router = require('express').Router();
const { getAll, getById, create, updateStatus, remove, uploadPelunasan, verifyPelunasan, rejectPelunasan, verifyQr } = require('../controllers/pendaftaran.controller');
const { authenticate, isAdmin } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');

router.get('/verify-qr/:token', authenticate, verifyQr);
router.get('/', authenticate, getAll);
router.get('/:id', authenticate, getById);
router.post('/', authenticate, upload.fields([
  { name: 'buktiPembayaran', maxCount: 1 },
  { name: 'buktiDP', maxCount: 1 },
  { name: 'dokumen', maxCount: 1 }
]), create);
router.patch('/:id/status', authenticate, isAdmin, updateStatus);
router.patch('/:id/pelunasan', authenticate, upload.fields([
  { name: 'buktiPelunasan', maxCount: 1 }
]), uploadPelunasan);
router.patch('/:id/verify-pelunasan', authenticate, isAdmin, verifyPelunasan);
router.patch('/:id/reject-pelunasan', authenticate, isAdmin, rejectPelunasan);
router.delete('/:id', authenticate, remove);

module.exports = router;
