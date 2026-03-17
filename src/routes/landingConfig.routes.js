const router = require('express').Router();
const { authenticate, isAdmin } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');
const ctrl = require('../controllers/landingConfig.controller');

// ── Public routes ──
router.post('/feedback', ctrl.submitFeedback);
router.get('/struktur', ctrl.getStruktur); // Public untuk landing page
router.get('/config', ctrl.getSiteConfig); // Public untuk footer & landing page
router.get('/hero-slides/public', ctrl.getHeroSlides); // Public untuk landing page
router.get('/berita/public', ctrl.getBerita); // Public untuk landing page
router.get('/berita/public/:id', ctrl.getBeritaById); // Public detail berita
router.get('/merchandise', ctrl.getMerchandise); // Public untuk landing page

// ── Admin routes ──
router.use(authenticate, isAdmin);

// Debug: upload health check  
router.get('/upload-health', ctrl.checkUploadHealth);

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
router.put('/config', ctrl.updateSiteConfig);

// Merchandise
router.get('/merchandise/admin', ctrl.getMerchandise);
router.get('/merchandise/:id', ctrl.getMerchandiseById);
router.post('/merchandise', upload.single('gambar'), ctrl.createMerchandise);
router.put('/merchandise/:id', upload.single('gambar'), ctrl.updateMerchandise);
router.delete('/merchandise/:id', ctrl.deleteMerchandise);

// Struktur Organisasi (Admin only for CUD)
router.post('/struktur', upload.single('foto'), ctrl.createStruktur);
router.put('/struktur/:id', upload.single('foto'), ctrl.updateStruktur);
router.delete('/struktur/:id', ctrl.deleteStruktur);

module.exports = router;
