const express = require('express');
const router = express.Router();
const { authenticate, isAdmin } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');
const { getConfig, getAllConfigs, saveSignature, saveStamp, getSuratConfig } = require('../controllers/siteConfig.controller');

// Public: get surat config (for displaying on approved rekomendasi)
router.get('/surat-config', authenticate, getSuratConfig);

// Admin: get all configs
router.get('/', authenticate, isAdmin, getAllConfigs);

// Admin: get specific config
router.get('/:key', authenticate, isAdmin, getConfig);

// Admin: save signature (canvas base64)
router.post('/signature', authenticate, isAdmin, saveSignature);

// Admin: save stamp (upload image)
router.post('/stamp', authenticate, isAdmin, upload.single('stamp'), saveStamp);

module.exports = router;
