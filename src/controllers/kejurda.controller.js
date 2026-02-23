const prisma = require('../lib/prisma');

// ========= KEJURDA (Admin) =========
const getAllKejurda = async (req, res) => {
  try {
    const kejurda = await prisma.kejurda.findMany({
      orderBy: { tanggalMulai: 'desc' },
      include: {
        _count: { select: { pendaftaran: true } },
        pengcabPengaju: { select: { id: true, nama: true, kota: true } }
      }
    });
    res.json(kejurda);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data kejurda', detail: error.message });
  }
};

const getKejurdaById = async (req, res) => {
  try {
    const kejurda = await prisma.kejurda.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        pendaftaran: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            pengcab: { select: { id: true, nama: true, kota: true } }
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    });
    if (!kejurda) return res.status(404).json({ error: 'Kejurda tidak ditemukan' });
    res.json(kejurda);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data', detail: error.message });
  }
};

const createKejurda = async (req, res) => {
  try {
    const { namaKejurda, tanggalMulai, tanggalSelesai, lokasi, deskripsi, jenisEvent } = req.body;
    const jenis = jenisEvent || 'KEJURDA';
    const poster = req.file ? `/uploads/${req.file.filename}` : null;

    // KEJURDA & KEJURCAB: max 1 per year
    if (jenis === 'KEJURDA' || jenis === 'KEJURCAB') {
      const year = new Date(tanggalMulai).getFullYear();
      const existing = await prisma.kejurda.findFirst({
        where: {
          jenisEvent: jenis,
          tanggalMulai: {
            gte: new Date(`${year}-01-01`),
            lt: new Date(`${year + 1}-01-01`),
          }
        }
      });
      if (existing) {
        const label = jenis === 'KEJURDA' ? 'Kejurda' : 'Kejurcab';
        return res.status(400).json({ error: `${label} tahun ${year} sudah ada ("${existing.namaKejurda}"). Hanya boleh 1 ${label} per tahun.` });
      }
    }

    const kejurda = await prisma.kejurda.create({
      data: {
        namaKejurda,
        jenisEvent: jenis,
        tanggalMulai: new Date(tanggalMulai),
        tanggalSelesai: new Date(tanggalSelesai),
        lokasi, deskripsi, poster
      }
    });
    res.status(201).json({ message: 'Event berhasil dibuat', kejurda });
  } catch (error) {
    res.status(500).json({ error: 'Gagal membuat event', detail: error.message });
  }
};

const updateKejurda = async (req, res) => {
  try {
    const { namaKejurda, tanggalMulai, tanggalSelesai, lokasi, deskripsi, statusBuka, jenisEvent } = req.body;
    const data = { namaKejurda, lokasi, deskripsi };
    if (jenisEvent) data.jenisEvent = jenisEvent;
    if (tanggalMulai) data.tanggalMulai = new Date(tanggalMulai);
    if (tanggalSelesai) data.tanggalSelesai = new Date(tanggalSelesai);
    if (statusBuka !== undefined) data.statusBuka = statusBuka === 'true' || statusBuka === true;
    if (req.file) data.poster = `/uploads/${req.file.filename}`;

    // KEJURDA & KEJURCAB: max 1 per year (exclude self)
    const targetJenis = jenisEvent || (await prisma.kejurda.findUnique({ where: { id: parseInt(req.params.id) } }))?.jenisEvent;
    const targetDate = tanggalMulai || (await prisma.kejurda.findUnique({ where: { id: parseInt(req.params.id) } }))?.tanggalMulai;
    if (targetJenis && (targetJenis === 'KEJURDA' || targetJenis === 'KEJURCAB') && targetDate) {
      const year = new Date(targetDate).getFullYear();
      const existing = await prisma.kejurda.findFirst({
        where: {
          jenisEvent: targetJenis,
          id: { not: parseInt(req.params.id) },
          tanggalMulai: {
            gte: new Date(`${year}-01-01`),
            lt: new Date(`${year + 1}-01-01`),
          }
        }
      });
      if (existing) {
        const label = targetJenis === 'KEJURDA' ? 'Kejurda' : 'Kejurcab';
        return res.status(400).json({ error: `${label} tahun ${year} sudah ada ("${existing.namaKejurda}"). Hanya boleh 1 ${label} per tahun.` });
      }
    }

    const kejurda = await prisma.kejurda.update({
      where: { id: parseInt(req.params.id) },
      data
    });
    res.json({ message: 'Kejurda berhasil diupdate', kejurda });
  } catch (error) {
    res.status(500).json({ error: 'Gagal update kejurda', detail: error.message });
  }
};

const removeKejurda = async (req, res) => {
  try {
    await prisma.kejurda.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ message: 'Kejurda berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menghapus kejurda', detail: error.message });
  }
};

// ========= Kejurda Publik =========
const getOpenKejurda = async (req, res) => {
  try {
    const where = { statusBuka: true, statusApproval: 'DISETUJUI' };
    if (req.query.jenis) where.jenisEvent = req.query.jenis;
    const kejurda = await prisma.kejurda.findMany({
      where,
      orderBy: { tanggalMulai: 'asc' }
    });
    res.json(kejurda);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data event', detail: error.message });
  }
};

module.exports = { getAllKejurda, getKejurdaById, createKejurda, updateKejurda, removeKejurda, getOpenKejurda, approveKejurda, rejectKejurda };

// ========= Admin Approval for Pengcab-submitted Kejurcab =========
async function approveKejurda(req, res) {
  try {
    const kejurda = await prisma.kejurda.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!kejurda) return res.status(404).json({ error: 'Event tidak ditemukan' });
    if (kejurda.statusApproval !== 'PENDING') {
      return res.status(400).json({ error: 'Event ini sudah diproses sebelumnya' });
    }

    const updated = await prisma.kejurda.update({
      where: { id: kejurda.id },
      data: {
        statusApproval: 'DISETUJUI',
        statusBuka: true,
        catatanAdmin: req.body.catatan || null,
      }
    });
    res.json({ message: 'Pengajuan Kejurcab disetujui', kejurda: updated });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menyetujui', detail: error.message });
  }
}

async function rejectKejurda(req, res) {
  try {
    const kejurda = await prisma.kejurda.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!kejurda) return res.status(404).json({ error: 'Event tidak ditemukan' });
    if (kejurda.statusApproval !== 'PENDING') {
      return res.status(400).json({ error: 'Event ini sudah diproses sebelumnya' });
    }

    const updated = await prisma.kejurda.update({
      where: { id: kejurda.id },
      data: {
        statusApproval: 'DITOLAK',
        catatanAdmin: req.body.catatan || 'Ditolak oleh Pengda',
      }
    });
    res.json({ message: 'Pengajuan Kejurcab ditolak', kejurda: updated });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menolak', detail: error.message });
  }
}
