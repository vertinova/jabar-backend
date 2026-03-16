const router = require('express').Router();
const { authenticate, isAdmin } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/apiKey.controller');

// All routes require admin auth
router.use(authenticate, isAdmin);

router.get('/', ctrl.listApiKeys);
router.post('/', ctrl.createApiKey);
router.put('/:id', ctrl.updateApiKey);
router.delete('/:id', ctrl.deleteApiKey);
router.get('/:id/logs', ctrl.getApiKeyLogs);

module.exports = router;
