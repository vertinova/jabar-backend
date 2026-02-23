const router = require('express').Router();
const { getAll, getById, create, updateStatus, remove } = require('../controllers/rekomendasi.controller');
const { authenticate, isAdmin } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');

router.get('/', authenticate, getAll);
router.get('/:id', authenticate, getById);
router.post('/', authenticate, upload.any(), create);  // Support multiple file uploads for persyaratan
router.patch('/:id/status', authenticate, isAdmin, updateStatus);
router.delete('/:id', authenticate, remove);

module.exports = router;
