const router = require('express').Router();
const { getAll, create, update, remove } = require('../controllers/kategoriEvent.controller');
const { authenticate, isAdmin } = require('../middleware/auth.middleware');

// Public — frontend needs categories for tabs/filters
router.get('/', getAll);

// Admin only
router.post('/', authenticate, isAdmin, create);
router.put('/:id', authenticate, isAdmin, update);
router.delete('/:id', authenticate, isAdmin, remove);

module.exports = router;
