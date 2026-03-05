const router = require('express').Router();
const { getAllKejurda, getKejurdaById, createKejurda, updateKejurda, removeKejurda, getOpenKejurda, approveKejurda, rejectKejurda, toggleEarlyBird, toggleRegistration, generateSuratKejurcab } = require('../controllers/kejurda.controller');
const { authenticate, isAdmin } = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');

// Public
router.get('/open', getOpenKejurda);

// Admin
router.get('/', authenticate, isAdmin, getAllKejurda);
router.get('/:id', authenticate, getKejurdaById);
router.post('/', authenticate, isAdmin, upload.single('poster'), createKejurda);
router.put('/:id', authenticate, isAdmin, upload.single('poster'), updateKejurda);
router.delete('/:id', authenticate, isAdmin, removeKejurda);
router.patch('/:id/approve', authenticate, isAdmin, approveKejurda);
router.patch('/:id/reject', authenticate, isAdmin, rejectKejurda);
router.patch('/:id/toggle-early-bird', authenticate, isAdmin, toggleEarlyBird);
router.patch('/:id/toggle-registration', authenticate, isAdmin, toggleRegistration);
router.post('/:id/generate-surat', authenticate, isAdmin, generateSuratKejurcab);

module.exports = router;