const router = require('express').Router();
const { authenticateApiKey, requirePermission } = require('../middleware/apiKey.middleware');
const upload = require('../middleware/upload.middleware');

// Controllers
const landingCtrl = require('../controllers/landingConfig.controller');
const pengcabCtrl = require('../controllers/pengcab.controller');
const rekomendasiCtrl = require('../controllers/rekomendasi.controller');
const kejurdaCtrl = require('../controllers/kejurda.controller');
const pendaftaranCtrl = require('../controllers/pendaftaran.controller');
const adminUserCtrl = require('../controllers/adminUser.controller');
const dashboardCtrl = require('../controllers/dashboard.controller');
const kategoriCtrl = require('../controllers/kategoriEvent.controller');
const formatDokumenCtrl = require('../controllers/formatDokumen.controller');
const siteConfigCtrl = require('../controllers/siteConfig.controller');

// Wrap multer.any() for rekomendasi-style uploads
const handleUploadAny = (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'Ukuran file terlalu besar. Maksimal 5MB per file.'
        : err.message || 'Gagal upload file';
      return res.status(400).json({ error: msg });
    }
    next();
  });
};

// Wrap multer.fields for pendaftaran
const handlePendaftaranUpload = (req, res, next) => {
  upload.fields([
    { name: 'buktiPembayaran', maxCount: 1 },
    { name: 'buktiDP', maxCount: 1 },
    { name: 'dokumen', maxCount: 1 },
  ])(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'Ukuran file terlalu besar. Maksimal 5MB per file.'
        : err.message || 'Gagal upload file';
      return res.status(400).json({ error: msg });
    }
    next();
  });
};

const handlePelunasanUpload = (req, res, next) => {
  upload.fields([{ name: 'buktiPelunasan', maxCount: 1 }])(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Gagal upload file' });
    next();
  });
};

// ══════════════════════════════════════════
// PUBLIC ROUTES (no API key needed)
// ══════════════════════════════════════════

// Public landing data for a region (consumed by Pusat to display regional info)
router.get('/landing/public/:region', async (req, res) => {
  const prisma = require('../lib/prisma');
  try {
    const [heroSlides, berita, struktur, config, kejurdaOpen] = await Promise.all([
      prisma.heroSlide.findMany({ where: { aktif: true }, orderBy: { urutan: 'asc' } }),
      prisma.berita.findMany({ where: { aktif: true }, orderBy: { createdAt: 'desc' }, take: 10 }),
      prisma.strukturOrganisasi.findMany({ where: { aktif: true }, orderBy: { urutan: 'asc' } }),
      prisma.siteConfig.findMany().then(rows => {
        const obj = {};
        rows.forEach(r => { obj[r.key] = r.value; });
        return obj;
      }),
      prisma.kejurda.findMany({
        where: { statusBuka: true, statusApproval: 'DISETUJUI' },
        orderBy: { tanggalMulai: 'asc' },
        select: { id: true, namaKejurda: true, jenisEvent: true, tanggalMulai: true, tanggalSelesai: true, lokasi: true, poster: true, deskripsi: true },
      }),
    ]);
    res.json({
      region: req.params.region,
      heroSlides,
      berita,
      struktur,
      config,
      kejurdaOpen,
    });
  } catch (error) {
    console.error('[External] Public landing error:', error.message);
    res.status(500).json({ error: 'Gagal memuat data landing' });
  }
});

// ══════════════════════════════════════════
// All routes below require API key auth
// ══════════════════════════════════════════
router.use(authenticateApiKey);

// ══════════════════════════════════════════
// LANDING PAGE
// ══════════════════════════════════════════
// Hero Slides
router.get('/landing/hero-slides', requirePermission('landing:read'), landingCtrl.getHeroSlides);
router.post('/landing/hero-slides', requirePermission('landing:write'), upload.single('gambar'), landingCtrl.createHeroSlide);
router.put('/landing/hero-slides/:id', requirePermission('landing:write'), upload.single('gambar'), landingCtrl.updateHeroSlide);
router.delete('/landing/hero-slides/:id', requirePermission('landing:delete'), landingCtrl.deleteHeroSlide);

// Berita
router.get('/landing/berita', requirePermission('landing:read'), landingCtrl.getBerita);
router.get('/landing/berita/:id', requirePermission('landing:read'), landingCtrl.getBeritaById);
router.post('/landing/berita', requirePermission('landing:write'), upload.single('gambar'), landingCtrl.createBerita);
router.put('/landing/berita/:id', requirePermission('landing:write'), upload.single('gambar'), landingCtrl.updateBerita);
router.delete('/landing/berita/:id', requirePermission('landing:delete'), landingCtrl.deleteBerita);

// Struktur Organisasi
router.get('/landing/struktur', requirePermission('landing:read'), landingCtrl.getStruktur);
router.post('/landing/struktur', requirePermission('landing:write'), upload.single('foto'), landingCtrl.createStruktur);
router.put('/landing/struktur/:id', requirePermission('landing:write'), upload.single('foto'), landingCtrl.updateStruktur);
router.delete('/landing/struktur/:id', requirePermission('landing:delete'), landingCtrl.deleteStruktur);

// Feedback
router.get('/landing/feedback', requirePermission('landing:read'), landingCtrl.getFeedback);
router.put('/landing/feedback/:id/read', requirePermission('landing:write'), landingCtrl.markFeedbackRead);
router.delete('/landing/feedback/:id', requirePermission('landing:delete'), landingCtrl.deleteFeedback);

// Site Config (landing)
router.get('/landing/config', requirePermission('landing:read'), landingCtrl.getSiteConfig);
router.put('/landing/config', requirePermission('landing:write'), landingCtrl.updateSiteConfig);

// ══════════════════════════════════════════
// PENGCAB
// ══════════════════════════════════════════
router.get('/pengcab', requirePermission('pengcab:read'), pengcabCtrl.getAll);
router.get('/pengcab/:id', requirePermission('pengcab:read'), pengcabCtrl.getById);
router.post('/pengcab', requirePermission('pengcab:write'), upload.single('logo'), pengcabCtrl.create);
router.post('/pengcab/sync-forbasi', requirePermission('pengcab:write'), pengcabCtrl.syncFromForbasi);
router.put('/pengcab/:id', requirePermission('pengcab:write'), upload.single('logo'), pengcabCtrl.update);
router.delete('/pengcab/:id', requirePermission('pengcab:delete'), pengcabCtrl.remove);

// ══════════════════════════════════════════
// REKOMENDASI EVENT
// ══════════════════════════════════════════
router.get('/rekomendasi', requirePermission('rekomendasi:read'), rekomendasiCtrl.getAll);
router.get('/rekomendasi/:id', requirePermission('rekomendasi:read'), rekomendasiCtrl.getById);
router.post('/rekomendasi', requirePermission('rekomendasi:write'), handleUploadAny, rekomendasiCtrl.create);
router.put('/rekomendasi/:id', requirePermission('rekomendasi:write'), handleUploadAny, rekomendasiCtrl.update);
router.patch('/rekomendasi/:id/status', requirePermission('rekomendasi:write'), rekomendasiCtrl.updateStatus);
router.delete('/rekomendasi/:id', requirePermission('rekomendasi:delete'), rekomendasiCtrl.remove);

// ══════════════════════════════════════════
// KEJURDA / EVENT
// ══════════════════════════════════════════
router.get('/kejurda', requirePermission('kejurda:read'), kejurdaCtrl.getAllKejurda);
router.get('/kejurda/open', requirePermission('kejurda:read'), kejurdaCtrl.getOpenKejurda);
router.get('/kejurda/:id', requirePermission('kejurda:read'), kejurdaCtrl.getKejurdaById);
router.post('/kejurda', requirePermission('kejurda:write'), upload.single('poster'), kejurdaCtrl.createKejurda);
router.put('/kejurda/:id', requirePermission('kejurda:write'), upload.single('poster'), kejurdaCtrl.updateKejurda);
router.delete('/kejurda/:id', requirePermission('kejurda:delete'), kejurdaCtrl.removeKejurda);
router.patch('/kejurda/:id/approve', requirePermission('kejurda:write'), kejurdaCtrl.approveKejurda);
router.patch('/kejurda/:id/reject', requirePermission('kejurda:write'), kejurdaCtrl.rejectKejurda);
router.patch('/kejurda/:id/toggle-early-bird', requirePermission('kejurda:write'), kejurdaCtrl.toggleEarlyBird);
router.patch('/kejurda/:id/toggle-registration', requirePermission('kejurda:write'), kejurdaCtrl.toggleRegistration);
router.post('/kejurda/:id/generate-surat', requirePermission('kejurda:write'), kejurdaCtrl.generateSuratKejurcab);

// ══════════════════════════════════════════
// PENDAFTARAN
// ══════════════════════════════════════════
router.get('/pendaftaran', requirePermission('pendaftaran:read'), pendaftaranCtrl.getAll);
router.get('/pendaftaran/:id', requirePermission('pendaftaran:read'), pendaftaranCtrl.getById);
router.post('/pendaftaran', requirePermission('pendaftaran:write'), handlePendaftaranUpload, pendaftaranCtrl.create);
router.patch('/pendaftaran/:id/status', requirePermission('pendaftaran:write'), pendaftaranCtrl.updateStatus);
router.patch('/pendaftaran/:id/pelunasan', requirePermission('pendaftaran:write'), handlePelunasanUpload, pendaftaranCtrl.uploadPelunasan);
router.patch('/pendaftaran/:id/verify-pelunasan', requirePermission('pendaftaran:write'), pendaftaranCtrl.verifyPelunasan);
router.patch('/pendaftaran/:id/reject-pelunasan', requirePermission('pendaftaran:write'), pendaftaranCtrl.rejectPelunasan);
router.delete('/pendaftaran/:id', requirePermission('pendaftaran:delete'), pendaftaranCtrl.remove);

// ══════════════════════════════════════════
// USERS
// ══════════════════════════════════════════
router.get('/users', requirePermission('users:read'), adminUserCtrl.getAllUsers);
router.get('/users/stats', requirePermission('users:read'), adminUserCtrl.getUserStats);
router.get('/users/anggota-kta', requirePermission('users:read'), adminUserCtrl.getAnggotaKta);
router.get('/users/:id', requirePermission('users:read'), adminUserCtrl.getUserById);
router.put('/users/:id', requirePermission('users:write'), adminUserCtrl.updateUser);

// ══════════════════════════════════════════
// DASHBOARD & STATS
// ══════════════════════════════════════════
router.get('/dashboard/stats', requirePermission('dashboard:read'), dashboardCtrl.getStats);
router.get('/dashboard/landing', requirePermission('dashboard:read'), dashboardCtrl.getLandingData);
router.get('/dashboard/anggota', requirePermission('dashboard:read'), dashboardCtrl.getAnggotaForbasi);
router.post('/dashboard/anggota/refresh', requirePermission('dashboard:write'), dashboardCtrl.clearAnggotaCache);

// ══════════════════════════════════════════
// KATEGORI EVENT
// ══════════════════════════════════════════
router.get('/kategori-event', requirePermission('kejurda:read'), kategoriCtrl.getAll);
router.post('/kategori-event', requirePermission('kejurda:write'), kategoriCtrl.create);
router.put('/kategori-event/:id', requirePermission('kejurda:write'), kategoriCtrl.update);
router.delete('/kategori-event/:id', requirePermission('kejurda:delete'), kategoriCtrl.remove);

// ══════════════════════════════════════════
// FORMAT DOKUMEN
// ══════════════════════════════════════════
router.get('/format-dokumen', requirePermission('dokumen:read'), formatDokumenCtrl.getAllAdmin);
router.post('/format-dokumen', requirePermission('dokumen:write'), upload.single('file'), formatDokumenCtrl.create);
router.put('/format-dokumen/:id', requirePermission('dokumen:write'), upload.single('file'), formatDokumenCtrl.update);
router.delete('/format-dokumen/:id', requirePermission('dokumen:delete'), formatDokumenCtrl.remove);

// ══════════════════════════════════════════
// SITE CONFIG (Surat, Signature, Stamp)
// ══════════════════════════════════════════
router.get('/site-config', requirePermission('config:read'), siteConfigCtrl.getAllConfigs);
router.get('/site-config/surat-config', requirePermission('config:read'), siteConfigCtrl.getSuratConfig);
router.get('/site-config/:key', requirePermission('config:read'), siteConfigCtrl.getConfig);
router.post('/site-config/signature', requirePermission('config:write'), siteConfigCtrl.saveSignature);
router.post('/site-config/stamp', requirePermission('config:write'), upload.single('stamp'), siteConfigCtrl.saveStamp);

// ══════════════════════════════════════════
// API KEY INFO (check own key)
// ══════════════════════════════════════════
router.get('/api-key/info', (req, res) => {
  res.json({
    id: req.apiClient.id,
    name: req.apiClient.name,
    permissions: req.apiClient.permissions,
  });
});

module.exports = router;
