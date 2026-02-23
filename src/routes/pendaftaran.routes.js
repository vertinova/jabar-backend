const router = require('express').Router();
const { getAll, getById, create, createPublic, updateStatus, remove } = require('../controllers/pendaftaran.controller');
const { authenticate, isAdmin } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');

router.get('/', authenticate, getAll);
router.get('/:id', authenticate, getById);
// Support multiple file uploads: dokumen + up to 20 dynamic files
router.post('/', authenticate, upload.fields([
  { name: 'dokumen', maxCount: 1 },
  { name: 'files', maxCount: 20 }
]), create);
// Public registration for UMUM events (no auth required)
router.post('/public', upload.fields([
  { name: 'dokumen', maxCount: 1 },
  { name: 'files', maxCount: 20 }
]), createPublic);
router.patch('/:id/status', authenticate, isAdmin, updateStatus);
router.delete('/:id', authenticate, remove);

module.exports = router;
