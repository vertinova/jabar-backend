const router = require('express').Router();
const { getAll, getById, create, update, remove, syncFromForbasi } = require('../controllers/pengcab.controller');
const { authenticate, isAdmin } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');

router.get('/', getAll);
router.get('/:id', getById);
router.post('/', authenticate, isAdmin, upload.single('logo'), create);
router.post('/sync-forbasi', authenticate, isAdmin, syncFromForbasi);
router.put('/:id', authenticate, isAdmin, upload.single('logo'), update);
router.delete('/:id', authenticate, isAdmin, remove);

module.exports = router;
