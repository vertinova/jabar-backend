const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

// GET /api/pengcab-panel/dashboard
const getDashboard = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { pengcab: true }
    });
    if (!user || !user.pengcabId) {
      return res.status(400).json({ error: 'Pengcab tidak ditemukan untuk user ini' });
    }
    const pengcabId = user.pengcabId;

    const [totalRekomendasi, pendingRekomendasi, approvedRekomendasi, totalPendaftaran] = await Promise.all([
      prisma.rekomendasiEvent.count({ where: { pengcabId } }),
      prisma.rekomendasiEvent.count({ where: { pengcabId, status: 'PENDING' } }),
      prisma.rekomendasiEvent.count({ where: { pengcabId, status: { in: ['APPROVED_PENGCAB', 'DISETUJUI'] } } }),
      prisma.pendaftaranKejurda.count({ where: { pengcabId } }),
    ]);

    const recentRekomendasi = await prisma.rekomendasiEvent.findMany({
      where: { pengcabId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { user: { select: { name: true } }, pengcab: { select: { nama: true } } }
    });

    const recentPendaftaran = await prisma.pendaftaranKejurda.findMany({
      where: { pengcabId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { kejurda: { select: { namaKejurda: true } }, user: { select: { name: true } } }
    });

    res.json({
      totalRekomendasi,
      pendingRekomendasi,
      approvedRekomendasi,
      totalPendaftaran,
      recentRekomendasi: recentRekomendasi.map(r => ({
        id: r.id,
        namaEvent: r.namaEvent,
        penyelenggara: r.penyelenggara,
        tanggalMulai: r.tanggalMulai,
        status: r.status,
      })),
      recentPendaftaran: recentPendaftaran.map(p => ({
        id: p.id,
        namaAtlet: p.namaAtlet,
        status: p.status,
        kejurda: p.kejurda,
      })),
    });
  } catch (error) {
    console.error('Pengcab dashboard error:', error);
    res.status(500).json({ error: 'Gagal memuat dashboard pengcab' });
  }
};

// GET /api/pengcab-panel/rekomendasi
const getRekomendasi = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.pengcabId) return res.status(400).json({ error: 'Pengcab tidak ditemukan' });

    const items = await prisma.rekomendasiEvent.findMany({
      where: { pengcabId: user.pengcabId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true } },
        pengcab: { select: { nama: true } },
      }
    });

    res.json(items.map(i => ({
      id: i.id,
      namaEvent: i.namaEvent,
      jenisEvent: i.jenisEvent,
      penyelenggara: i.penyelenggara,
      tanggalMulai: i.tanggalMulai,
      tanggalSelesai: i.tanggalSelesai,
      lokasi: i.lokasi,
      deskripsi: i.deskripsi,
      kontakPerson: i.kontakPerson,
      noBilingSimpaskor: i.noBilingSimpaskor,
      dokumenSurat: i.dokumenSurat,
      persyaratan: i.persyaratan,
      mataLomba: i.mataLomba,
      status: i.status,
      catatanPengcab: i.catatanPengcab,
      user: { name: i.user.name, email: i.user.email },
      pengcab: { nama: i.pengcab?.nama },
      createdAt: i.createdAt,
    })));
  } catch (error) {
    console.error('Pengcab rekomendasi error:', error);
    res.status(500).json({ error: 'Gagal memuat rekomendasi' });
  }
};

// PUT /api/pengcab-panel/rekomendasi/:id/approve
const approveRekomendasi = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.pengcabId) return res.status(400).json({ error: 'Pengcab tidak ditemukan' });

    const item = await prisma.rekomendasiEvent.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!item) return res.status(404).json({ error: 'Rekomendasi tidak ditemukan' });
    if (item.pengcabId !== user.pengcabId) return res.status(403).json({ error: 'Akses ditolak' });
    if (item.status !== 'PENDING') return res.status(400).json({ error: 'Status harus PENDING untuk disetujui' });

    const updated = await prisma.rekomendasiEvent.update({
      where: { id: item.id },
      data: {
        status: 'APPROVED_PENGCAB',
        catatanPengcab: req.body.catatan || null,
        approvedPengcabAt: new Date(),
      }
    });
    res.json(updated);
  } catch (error) {
    console.error('Approve rekomendasi error:', error);
    res.status(500).json({ error: 'Gagal menyetujui rekomendasi' });
  }
};

// PUT /api/pengcab-panel/rekomendasi/:id/reject
const rejectRekomendasi = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.pengcabId) return res.status(400).json({ error: 'Pengcab tidak ditemukan' });

    const item = await prisma.rekomendasiEvent.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!item) return res.status(404).json({ error: 'Rekomendasi tidak ditemukan' });
    if (item.pengcabId !== user.pengcabId) return res.status(403).json({ error: 'Akses ditolak' });
    if (item.status !== 'PENDING') return res.status(400).json({ error: 'Status harus PENDING untuk ditolak' });

    const updated = await prisma.rekomendasiEvent.update({
      where: { id: item.id },
      data: {
        status: 'DITOLAK',
        catatanPengcab: req.body.catatan || 'Ditolak oleh pengcab',
      }
    });
    res.json(updated);
  } catch (error) {
    console.error('Reject rekomendasi error:', error);
    res.status(500).json({ error: 'Gagal menolak rekomendasi' });
  }
};

// GET /api/pengcab-panel/pendaftaran
const getPendaftaran = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.pengcabId) return res.status(400).json({ error: 'Pengcab tidak ditemukan' });

    const items = await prisma.pendaftaranKejurda.findMany({
      where: { pengcabId: user.pengcabId },
      orderBy: { createdAt: 'desc' },
      include: {
        kejurda: { select: { namaKejurda: true, lokasi: true, tanggalMulai: true } },
        user: { select: { name: true, email: true } },
        pengcab: { select: { nama: true } },
      }
    });

    res.json(items.map(i => ({
      id: i.id,
      namaAtlet: i.namaAtlet,
      kategori: i.kategori,
      kelas: i.kelasTanding,
      dokumen: i.dokumen,
      status: i.status,
      kejurda: i.kejurda,
      user: { namaLengkap: i.user.name },
      pengcab: { nama: i.pengcab?.nama },
      createdAt: i.createdAt,
    })));
  } catch (error) {
    console.error('Pengcab pendaftaran error:', error);
    res.status(500).json({ error: 'Gagal memuat pendaftaran' });
  }
};

// GET /api/pengcab-panel/anggota
const getAnggota = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.pengcabId) return res.status(400).json({ error: 'Pengcab tidak ditemukan' });

    const members = await prisma.user.findMany({
      where: { pengcabId: user.pengcabId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        createdAt: true,
      }
    });

    res.json(members.map(m => ({
      id: m.id,
      namaLengkap: m.name,
      email: m.email,
      noHp: m.phone,
      role: m.role,
      createdAt: m.createdAt,
    })));
  } catch (error) {
    console.error('Pengcab anggota error:', error);
    res.status(500).json({ error: 'Gagal memuat anggota' });
  }
};

// PUT /api/pengcab-panel/anggota/:id — edit user profile in same pengcab
const updateAnggota = async (req, res) => {
  try {
    const currentUser = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!currentUser?.pengcabId) return res.status(400).json({ error: 'Pengcab tidak ditemukan' });

    const targetUser = await prisma.user.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!targetUser) return res.status(404).json({ error: 'Anggota tidak ditemukan' });
    if (targetUser.pengcabId !== currentUser.pengcabId) return res.status(403).json({ error: 'Akses ditolak. Anggota bukan dari pengcab Anda.' });

    const { name, phone, newPassword } = req.body;
    const updateData = {};

    if (name) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (newPassword) {
      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'Password baru minimal 6 karakter' });
      }
      updateData.password = await bcrypt.hash(newPassword, 10);
    }

    const updatedUser = await prisma.user.update({
      where: { id: targetUser.id },
      data: updateData,
      select: { id: true, name: true, email: true, phone: true, role: true, createdAt: true }
    });

    res.json({
      message: 'Data anggota berhasil diupdate',
      user: {
        id: updatedUser.id,
        namaLengkap: updatedUser.name,
        email: updatedUser.email,
        noHp: updatedUser.phone,
        role: updatedUser.role,
        createdAt: updatedUser.createdAt,
      }
    });
  } catch (error) {
    console.error('Update anggota error:', error);
    res.status(500).json({ error: 'Gagal update anggota', detail: error.message });
  }
};

module.exports = {
  getDashboard,
  getRekomendasi,
  approveRekomendasi,
  rejectRekomendasi,
  getPendaftaran,
  getAnggota,
  updateAnggota,
  getKejurcab,
  createKejurcab,
};

// GET /api/pengcab-panel/kejurcab
async function getKejurcab(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.pengcabId) return res.status(400).json({ error: 'Pengcab tidak ditemukan' });

    const items = await prisma.kejurda.findMany({
      where: { pengcabId: user.pengcabId, jenisEvent: 'KEJURCAB' },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { pendaftaran: true } } }
    });

    res.json(items);
  } catch (error) {
    console.error('Pengcab kejurcab error:', error);
    res.status(500).json({ error: 'Gagal memuat data kejurcab' });
  }
}

// POST /api/pengcab-panel/kejurcab
async function createKejurcab(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: { pengcab: true } });
    if (!user?.pengcabId) return res.status(400).json({ error: 'Pengcab tidak ditemukan' });

    const { namaKejurda, tanggalMulai, tanggalSelesai, lokasi, deskripsi } = req.body;
    if (!namaKejurda || !tanggalMulai || !tanggalSelesai || !lokasi) {
      return res.status(400).json({ error: 'Nama, tanggal mulai, tanggal selesai, dan lokasi wajib diisi' });
    }

    // Validate: max 1 KEJURCAB per pengcab per year
    const year = new Date(tanggalMulai).getFullYear();
    const existing = await prisma.kejurda.findFirst({
      where: {
        jenisEvent: 'KEJURCAB',
        pengcabId: user.pengcabId,
        tanggalMulai: {
          gte: new Date(`${year}-01-01`),
          lt: new Date(`${year + 1}-01-01`),
        }
      }
    });
    if (existing) {
      return res.status(400).json({
        error: `Pengcab ${user.pengcab.nama} sudah memiliki Kejurcab tahun ${year} ("${existing.namaKejurda}"). Hanya boleh 1 Kejurcab per pengcab per tahun.`
      });
    }

    const kejurcab = await prisma.kejurda.create({
      data: {
        namaKejurda,
        jenisEvent: 'KEJURCAB',
        tanggalMulai: new Date(tanggalMulai),
        tanggalSelesai: new Date(tanggalSelesai),
        lokasi,
        deskripsi: deskripsi || null,
        pengcabId: user.pengcabId,
        statusApproval: 'PENDING',
        statusBuka: false, // will be opened after admin approval
      }
    });

    res.status(201).json({ message: 'Pengajuan Kejurcab berhasil dikirim. Menunggu persetujuan Pengda.', kejurcab });
  } catch (error) {
    console.error('Create kejurcab error:', error);
    res.status(500).json({ error: 'Gagal mengajukan kejurcab', detail: error.message });
  }
}
