const router = require('express').Router();
const { authenticate, isAdmin } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');
const ctrl = require('../controllers/landingConfig.controller');

// ── Public routes ──
router.post('/feedback', ctrl.submitFeedback);

// ── Admin routes ──
router.use(authenticate, isAdmin);

// Hero Slides
router.get('/hero-slides', ctrl.getHeroSlides);
router.post('/hero-slides', upload.single('gambar'), ctrl.createHeroSlide);
router.put('/hero-slides/:id', upload.single('gambar'), ctrl.updateHeroSlide);
router.delete('/hero-slides/:id', ctrl.deleteHeroSlide);

// Berita
router.get('/berita', ctrl.getBerita);
router.get('/berita/:id', ctrl.getBeritaById);
router.post('/berita', upload.single('gambar'), ctrl.createBerita);
router.put('/berita/:id', upload.single('gambar'), ctrl.updateBerita);
router.delete('/berita/:id', ctrl.deleteBerita);

// Feedback
router.get('/feedback', ctrl.getFeedback);
router.put('/feedback/:id/read', ctrl.markFeedbackRead);
router.delete('/feedback/:id', ctrl.deleteFeedback);

// Site Config
router.get('/config', ctrl.getSiteConfig);
router.put('/config', ctrl.updateSiteConfig);

module.exports = router;
