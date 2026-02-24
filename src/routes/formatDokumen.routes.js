const router = require('express').Router();
const { getAll, getAllAdmin, create, update, remove } = require('../controllers/formatDokumen.controller');
const { authenticate, isAdmin } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');

// Public (for penyelenggara to download templates)
router.get('/', authenticate, getAll);

// Admin CRUD
router.get('/admin', authenticate, isAdmin, getAllAdmin);
router.post('/', authenticate, isAdmin, upload.single('file'), create);
router.put('/:id', authenticate, isAdmin, upload.single('file'), update);
router.delete('/:id', authenticate, isAdmin, remove);

module.exports = router;
