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
    const { kejurdaId, pengcabId, namaAtlet, kategori, kelasTanding } = req.body;
    const dokumen = req.file ? `/uploads/${req.file.filename}` : null;

    // Cek apakah kejurda masih buka
    const kejurda = await prisma.kejurda.findUnique({ where: { id: parseInt(kejurdaId) } });
    if (!kejurda || !kejurda.statusBuka) {
      return res.status(400).json({ error: 'Kejurda tidak ditemukan atau pendaftaran sudah ditutup' });
    }

    const pendaftaran = await prisma.pendaftaranKejurda.create({
      data: {
        kejurdaId: parseInt(kejurdaId),
        userId: req.user.id,
        pengcabId: pengcabId ? parseInt(pengcabId) : null,
        namaAtlet, kategori, kelasTanding, dokumen
      },
      include: {
        kejurda: { select: { id: true, namaKejurda: true, jenisEvent: true } },
        pengcab: { select: { id: true, nama: true } }
      }
    });
    res.status(201).json({ message: 'Pendaftaran berhasil', pendaftaran });
  } catch (error) {
    res.status(500).json({ error: 'Gagal mendaftar kejurda', detail: error.message });
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

module.exports = { getAll, getById, create, updateStatus, remove };
