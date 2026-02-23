const prisma = require('../lib/prisma');

const getAll = async (req, res) => {
  try {
    const { kejurdaId, status } = req.query;
    const where = {};
    
    if (req.user.role !== 'ADMIN') {
      where.userId = req.user.id;
    }
    if (kejurdaId) where.kejurdaId = parseInt(kejurdaId);
    if (status) where.status = status;

    const pendaftaran = await prisma.pendaftaranKejurda.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        kejurda: { select: { id: true, namaKejurda: true, jenisEvent: true } },
        user: { select: { id: true, name: true, email: true } },
        pengcab: { select: { id: true, nama: true, kota: true } }
      }
    });
    res.json(pendaftaran);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data pendaftaran', detail: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const pendaftaran = await prisma.pendaftaranKejurda.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        kejurda: true,
        user: { select: { id: true, name: true, email: true, phone: true } },
        pengcab: { select: { id: true, nama: true, kota: true } }
      }
    });
    if (!pendaftaran) return res.status(404).json({ error: 'Data tidak ditemukan' });
    
    if (req.user.role !== 'ADMIN' && pendaftaran.userId !== req.user.id) {
      return res.status(403).json({ error: 'Akses ditolak' });
    }
    
    res.json(pendaftaran);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data', detail: error.message });
  }
};

const create = async (req, res) => {
  try {
    const { kejurdaId, pengcabId, namaAtlet, kategori, kelasTanding, dataPersyaratan, catatanPeserta } = req.body;
    
    // Handle main document
    const dokumen = req.files?.dokumen?.[0] ? `/uploads/${req.files.dokumen[0].filename}` : null;
    
    // Handle dynamic form files
    const uploadedFiles = {};
    if (req.files?.files) {
      req.files.files.forEach((file, index) => {
        uploadedFiles[`file_${index}`] = `/uploads/${file.filename}`;
      });
    }

    // Cek apakah kejurda masih buka
    const kejurda = await prisma.kejurda.findUnique({ 
      where: { id: parseInt(kejurdaId) },
      include: { persyaratanFields: { where: { aktif: true } } }
    });
    if (!kejurda || !kejurda.statusBuka) {
      return res.status(400).json({ error: 'Event tidak ditemukan atau pendaftaran sudah ditutup' });
    }

    // Check batas pendaftaran
    if (kejurda.batasPendaftaran && new Date() > new Date(kejurda.batasPendaftaran)) {
      return res.status(400).json({ error: 'Batas waktu pendaftaran sudah lewat' });
    }

    // Parse dataPersyaratan if it's a string
    let parsedPersyaratan = dataPersyaratan;
    if (typeof dataPersyaratan === 'string') {
      try {
        parsedPersyaratan = JSON.parse(dataPersyaratan);
      } catch { parsedPersyaratan = {}; }
    }
    
    // Merge uploaded files into dataPersyaratan
    if (Object.keys(uploadedFiles).length > 0) {
      parsedPersyaratan = { ...parsedPersyaratan, _uploadedFiles: uploadedFiles };
    }

    const pendaftaran = await prisma.pendaftaranKejurda.create({
      data: {
        kejurdaId: parseInt(kejurdaId),
        userId: req.user.id,
        pengcabId: pengcabId ? parseInt(pengcabId) : null,
        namaAtlet, 
        kategori, 
        kelasTanding, 
        dokumen,
        dataPersyaratan: parsedPersyaratan,
        catatanPeserta
      },
      include: {
        kejurda: { select: { id: true, namaKejurda: true, jenisEvent: true } },
        pengcab: { select: { id: true, nama: true } }
      }
    });
    res.status(201).json({ message: 'Pendaftaran berhasil', pendaftaran });
  } catch (error) {
    res.status(500).json({ error: 'Gagal mendaftar event', detail: error.message });
  }
};

const updateStatus = async (req, res) => {
  try {
    const { status, catatanAdmin } = req.body;
    const pendaftaran = await prisma.pendaftaranKejurda.update({
      where: { id: parseInt(req.params.id) },
      data: { status, catatanAdmin }
    });
    res.json({ message: `Status pendaftaran diubah menjadi ${status}`, pendaftaran });
  } catch (error) {
    res.status(500).json({ error: 'Gagal update status', detail: error.message });
  }
};

const remove = async (req, res) => {
  try {
    const pendaftaran = await prisma.pendaftaranKejurda.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!pendaftaran) return res.status(404).json({ error: 'Data tidak ditemukan' });
    
    if (req.user.role !== 'ADMIN' && pendaftaran.userId !== req.user.id) {
      return res.status(403).json({ error: 'Akses ditolak' });
    }

    await prisma.pendaftaranKejurda.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ message: 'Pendaftaran berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menghapus data', detail: error.message });
  }
};

// Public registration for UMUM events (no auth required)
const createPublic = async (req, res) => {
  try {
    const { kejurdaId, namaAtlet, kategori, kelasTanding, guestEmail, guestPhone, dataPersyaratan, catatanPeserta } = req.body;
    
    // Validate required fields
    if (!kejurdaId || !namaAtlet || !guestEmail) {
      return res.status(400).json({ error: 'Nama dan email wajib diisi' });
    }

    // Check if event exists and is open for public registration
    const kejurda = await prisma.kejurda.findUnique({ 
      where: { id: parseInt(kejurdaId) },
      include: { persyaratanFields: { where: { aktif: true } } }
    });
    
    if (!kejurda || !kejurda.statusBuka) {
      return res.status(400).json({ error: 'Event tidak ditemukan atau pendaftaran sudah ditutup' });
    }
    
    // Check if event is UMUM type
    if (kejurda.targetPeserta !== 'UMUM') {
      return res.status(400).json({ error: 'Event ini khusus untuk anggota club. Silakan login terlebih dahulu.' });
    }

    // Check batas pendaftaran
    if (kejurda.batasPendaftaran && new Date() > new Date(kejurda.batasPendaftaran)) {
      return res.status(400).json({ error: 'Batas waktu pendaftaran sudah lewat' });
    }

    // Handle main document
    const dokumen = req.files?.dokumen?.[0] ? `/uploads/${req.files.dokumen[0].filename}` : null;
    
    // Handle dynamic form files
    const uploadedFiles = {};
    if (req.files?.files) {
      req.files.files.forEach((file, index) => {
        uploadedFiles[`file_${index}`] = `/uploads/${file.filename}`;
      });
    }

    // Parse dataPersyaratan if it's a string
    let parsedPersyaratan = dataPersyaratan;
    if (typeof dataPersyaratan === 'string') {
      try {
        parsedPersyaratan = JSON.parse(dataPersyaratan);
      } catch { parsedPersyaratan = {}; }
    }
    
    // Merge uploaded files into dataPersyaratan
    if (Object.keys(uploadedFiles).length > 0) {
      parsedPersyaratan = { ...parsedPersyaratan, _uploadedFiles: uploadedFiles };
    }

    const pendaftaran = await prisma.pendaftaranKejurda.create({
      data: {
        kejurdaId: parseInt(kejurdaId),
        userId: null, // No user for public registration
        namaAtlet, 
        kategori: kategori || 'Umum', 
        kelasTanding, 
        dokumen,
        dataPersyaratan: parsedPersyaratan,
        catatanPeserta,
        guestEmail,
        guestPhone
      },
      include: {
        kejurda: { select: { id: true, namaKejurda: true, jenisEvent: true } }
      }
    });
    
    res.status(201).json({ message: 'Pendaftaran berhasil! Kami akan menghubungi Anda melalui email.', pendaftaran });
  } catch (error) {
    res.status(500).json({ error: 'Gagal mendaftar event', detail: error.message });
  }
};

module.exports = { getAll, getById, create, createPublic, updateStatus, remove };
