const express = require('express');
const router = express.Router();
const { authenticate, isPengcab } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/pengcabPanel.controller');

router.use(authenticate, isPengcab);

router.get('/dashboard', ctrl.getDashboard);
router.get('/rekomendasi', ctrl.getRekomendasi);
router.put('/rekomendasi/:id/approve', ctrl.approveRekomendasi);
router.put('/rekomendasi/:id/reject', ctrl.rejectRekomendasi);
router.get('/pendaftaran', ctrl.getPendaftaran);
router.get('/anggota', ctrl.getAnggota);
router.put('/anggota/:id', ctrl.updateAnggota);
router.get('/kejurcab', ctrl.getKejurcab);
router.post('/kejurcab', ctrl.createKejurcab);

module.exports = router;
