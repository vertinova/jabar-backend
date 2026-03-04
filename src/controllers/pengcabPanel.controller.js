const prisma = require('../lib/prisma');
const bcrypt = require('bcryptjs');

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
      user: { name: i.user?.name || '-', email: i.user?.email || '-' },
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
        catatanPengcab: req.body?.catatan || null,
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

    const catatan = req.body?.catatan?.trim();
    if (!catatan) return res.status(400).json({ error: 'Catatan alasan penolakan wajib diisi' });

    const updated = await prisma.rekomendasiEvent.update({
      where: { id: item.id },
      data: {
        status: 'DITOLAK',
        catatanPengcab: catatan,
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
      user: { namaLengkap: i.user?.name || '-' },
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
  getKejurcabById,
  updateKejurcab,
  toggleKejurcabRegistration,
  getKejurcabPendaftaran,
  approvePendaftaran,
  rejectPendaftaran,
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

    const { namaKejurda, tanggalMulai, tanggalSelesai, lokasi, deskripsi, noBilingSimpaskor } = req.body;
    if (!namaKejurda || !tanggalMulai || !tanggalSelesai || !lokasi) {
      return res.status(400).json({ error: 'Nama, tanggal mulai, tanggal selesai, dan lokasi wajib diisi' });
    }

    // Billing Simpaskor wajib untuk Kejurcab
    if (!noBilingSimpaskor || !noBilingSimpaskor.trim()) {
      return res.status(400).json({ error: 'Nomor billing Simpaskor wajib diisi untuk mengajukan Kejurcab' });
    }

    // Verify billing against Simpaskor API
    const SIMPASKOR_API_URL = process.env.SIMPASKOR_API_URL || 'https://simpaskor.id/api/external';
    const SIMPASKOR_API_KEY = process.env.SIMPASKOR_API_KEY || 'SIMPASKOR_API_KEY_2026';
    try {
      const verifyUrl = `${SIMPASKOR_API_URL}/booking_detail.php?api_key=${encodeURIComponent(SIMPASKOR_API_KEY)}&billing_id=${encodeURIComponent(noBilingSimpaskor.trim())}`;
      const verifyResp = await fetch(verifyUrl, { method: 'GET', headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(10000) });
      const verifyData = await verifyResp.json();
      if (!verifyData.success || !verifyData.data) {
        return res.status(400).json({ error: 'Kode billing Simpaskor tidak valid. Pastikan nomor billing sudah benar dan terdaftar.' });
      }
      const paymentStatus = verifyData.data.payment?.status;
      if (!paymentStatus || paymentStatus.toLowerCase() !== 'lunas') {
        return res.status(400).json({ error: `Pembayaran billing Simpaskor belum lunas (status: ${paymentStatus || 'tidak diketahui'}). Lunasi terlebih dahulu.` });
      }
    } catch (verifyErr) {
      return res.status(502).json({ error: 'Gagal memverifikasi billing Simpaskor. Silakan coba lagi.' });
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

    // Parse files
    const files = req.files || [];
    const proposalFile = files.find(f => f.fieldname === 'proposalKegiatan');
    const proposal = proposalFile ? `/uploads/${proposalFile.filename}` : null;

    // Parse mataLomba JSON
    let mataLomba = null;
    if (req.body.mataLomba) {
      try { mataLomba = JSON.parse(req.body.mataLomba); } catch { mataLomba = {}; }
    }

    // Parse persyaratan JSON + file uploads
    let persyaratan = null;
    if (req.body.persyaratan) {
      try { persyaratan = JSON.parse(req.body.persyaratan); } catch { persyaratan = {}; }
      const fileFields = [
        'suratIzinSekolah', 'suratIzinKepolisian', 'suratRekomendasiDinas',
        'suratIzinVenue', 'suratRekomendasiPPI',
        'fotoLapangan', 'fotoTempatIbadah', 'fotoBarak', 'fotoAreaParkir',
        'fotoRuangKesehatan', 'fotoMCK', 'fotoTempatSampah', 'fotoRuangKomisi',
        'faktaIntegritasKomisi', 'faktaIntegritasHonor', 'faktaIntegritasPanitia',
        'desainSertifikat'
      ];
      for (const field of fileFields) {
        const uploadedFile = files.find(f => f.fieldname === field);
        if (uploadedFile) {
          if (!persyaratan[field]) persyaratan[field] = {};
          if (typeof persyaratan[field] === 'object') {
            persyaratan[field].file = `/uploads/${uploadedFile.filename}`;
          }
        }
      }
      // Handle juri foto uploads
      if (persyaratan.namaJuri && Array.isArray(persyaratan.namaJuri.juriList)) {
        persyaratan.namaJuri.juriList = persyaratan.namaJuri.juriList.map((juri, idx) => {
          const fotoFile = files.find(f => f.fieldname === `juriFoto_${idx}`);
          if (fotoFile) return { ...juri, foto: `/uploads/${fotoFile.filename}` };
          return juri;
        });
      }
    }

    const kejurcab = await prisma.kejurda.create({
      data: {
        namaKejurda,
        jenisEvent: 'KEJURCAB',
        tanggalMulai: new Date(tanggalMulai),
        tanggalSelesai: new Date(tanggalSelesai),
        lokasi,
        deskripsi: deskripsi || null,
        noBilingSimpaskor: noBilingSimpaskor.trim(),
        persyaratan: persyaratan || undefined,
        mataLomba: mataLomba || undefined,
        proposal: proposal || undefined,
        pengcabId: user.pengcabId,
        statusApproval: 'PENDING',
        statusBuka: false,
      }
    });

    res.status(201).json({ message: 'Pengajuan Kejurcab berhasil dikirim. Menunggu persetujuan Pengda.', kejurcab });
  } catch (error) {
    console.error('Create kejurcab error:', error);
    res.status(500).json({ error: 'Gagal mengajukan kejurcab', detail: error.message });
  }
}

// GET /api/pengcab-panel/kejurcab/:id
async function getKejurcabById(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.pengcabId) return res.status(400).json({ error: 'Pengcab tidak ditemukan' });

    const item = await prisma.kejurda.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        _count: { select: { pendaftaran: true } },
        pendaftaran: {
          include: {
            user: { select: { id: true, name: true, email: true, phone: true } },
            pengcab: { select: { id: true, nama: true, kota: true } }
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!item) return res.status(404).json({ error: 'Kejurcab tidak ditemukan' });
    if (item.pengcabId !== user.pengcabId) return res.status(403).json({ error: 'Akses ditolak' });

    res.json(item);
  } catch (error) {
    console.error('Get kejurcab by id error:', error);
    res.status(500).json({ error: 'Gagal memuat data kejurcab', detail: error.message });
  }
}

// PUT /api/pengcab-panel/kejurcab/:id
async function updateKejurcab(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.pengcabId) return res.status(400).json({ error: 'Pengcab tidak ditemukan' });

    const item = await prisma.kejurda.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!item) return res.status(404).json({ error: 'Kejurcab tidak ditemukan' });
    if (item.pengcabId !== user.pengcabId) return res.status(403).json({ error: 'Akses ditolak' });

    // Only allow update if still PENDING
    if (item.statusApproval !== 'PENDING') {
      return res.status(400).json({ error: 'Hanya kejurcab dengan status PENDING yang dapat diubah' });
    }

    const { namaKejurda, tanggalMulai, tanggalSelesai, lokasi, deskripsi } = req.body;
    const data = {};
    if (namaKejurda) data.namaKejurda = namaKejurda;
    if (tanggalMulai) data.tanggalMulai = new Date(tanggalMulai);
    if (tanggalSelesai) data.tanggalSelesai = new Date(tanggalSelesai);
    if (lokasi) data.lokasi = lokasi;
    if (deskripsi !== undefined) data.deskripsi = deskripsi;

    // Handle poster upload
    const files = req.files || [];
    const posterFile = files.find(f => f.fieldname === 'poster');
    if (posterFile) data.poster = `/uploads/${posterFile.filename}`;

    const updated = await prisma.kejurda.update({
      where: { id: item.id },
      data
    });

    res.json({ message: 'Kejurcab berhasil diupdate', kejurcab: updated });
  } catch (error) {
    console.error('Update kejurcab error:', error);
    res.status(500).json({ error: 'Gagal update kejurcab', detail: error.message });
  }
}

// PATCH /api/pengcab-panel/kejurcab/:id/toggle-registration
async function toggleKejurcabRegistration(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.pengcabId) return res.status(400).json({ error: 'Pengcab tidak ditemukan' });

    const item = await prisma.kejurda.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!item) return res.status(404).json({ error: 'Kejurcab tidak ditemukan' });
    if (item.pengcabId !== user.pengcabId) return res.status(403).json({ error: 'Akses ditolak' });

    // Only allow toggle if approved
    if (item.statusApproval !== 'DISETUJUI') {
      return res.status(400).json({ error: 'Hanya kejurcab yang sudah disetujui yang dapat dibuka/tutup pendaftarannya' });
    }

    const updated = await prisma.kejurda.update({
      where: { id: item.id },
      data: { statusBuka: !item.statusBuka }
    });

    res.json({
      message: `Pendaftaran ${updated.statusBuka ? 'dibuka' : 'ditutup'}`,
      kejurcab: updated
    });
  } catch (error) {
    console.error('Toggle kejurcab registration error:', error);
    res.status(500).json({ error: 'Gagal mengubah status pendaftaran', detail: error.message });
  }
}

// GET /api/pengcab-panel/kejurcab/:id/pendaftaran
async function getKejurcabPendaftaran(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.pengcabId) return res.status(400).json({ error: 'Pengcab tidak ditemukan' });

    const kejurcab = await prisma.kejurda.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!kejurcab) return res.status(404).json({ error: 'Kejurcab tidak ditemukan' });
    if (kejurcab.pengcabId !== user.pengcabId) return res.status(403).json({ error: 'Akses ditolak' });

    const items = await prisma.pendaftaranKejurda.findMany({
      where: { kejurdaId: parseInt(req.params.id) },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        pengcab: { select: { id: true, nama: true, kota: true } }
      }
    });

    res.json(items);
  } catch (error) {
    console.error('Get kejurcab pendaftaran error:', error);
    res.status(500).json({ error: 'Gagal memuat pendaftaran', detail: error.message });
  }
}

// PATCH /api/pengcab-panel/pendaftaran/:id/approve
async function approvePendaftaran(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.pengcabId) return res.status(400).json({ error: 'Pengcab tidak ditemukan' });

    const pendaftaran = await prisma.pendaftaranKejurda.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { kejurda: true }
    });

    if (!pendaftaran) return res.status(404).json({ error: 'Pendaftaran tidak ditemukan' });

    // Check if kejurda belongs to this pengcab
    if (pendaftaran.kejurda?.pengcabId !== user.pengcabId) {
      return res.status(403).json({ error: 'Akses ditolak. Pendaftaran ini bukan untuk kejurcab Anda.' });
    }

    if (pendaftaran.status !== 'PENDING') {
      return res.status(400).json({ error: 'Hanya pendaftaran dengan status PENDING yang dapat disetujui' });
    }

    const updated = await prisma.pendaftaranKejurda.update({
      where: { id: pendaftaran.id },
      data: {
        status: 'DISETUJUI',
        approvedAt: new Date()
      }
    });

    res.json({ message: 'Pendaftaran berhasil disetujui', pendaftaran: updated });
  } catch (error) {
    console.error('Approve pendaftaran error:', error);
    res.status(500).json({ error: 'Gagal menyetujui pendaftaran', detail: error.message });
  }
}

// PATCH /api/pengcab-panel/pendaftaran/:id/reject
async function rejectPendaftaran(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.pengcabId) return res.status(400).json({ error: 'Pengcab tidak ditemukan' });

    const pendaftaran = await prisma.pendaftaranKejurda.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { kejurda: true }
    });

    if (!pendaftaran) return res.status(404).json({ error: 'Pendaftaran tidak ditemukan' });

    // Check if kejurda belongs to this pengcab
    if (pendaftaran.kejurda?.pengcabId !== user.pengcabId) {
      return res.status(403).json({ error: 'Akses ditolak. Pendaftaran ini bukan untuk kejurcab Anda.' });
    }

    if (pendaftaran.status !== 'PENDING') {
      return res.status(400).json({ error: 'Hanya pendaftaran dengan status PENDING yang dapat ditolak' });
    }

    const catatan = req.body?.catatan?.trim();
    if (!catatan) {
      return res.status(400).json({ error: 'Alasan penolakan wajib diisi' });
    }

    const updated = await prisma.pendaftaranKejurda.update({
      where: { id: pendaftaran.id },
      data: {
        status: 'DITOLAK',
        catatan: catatan
      }
    });

    res.json({ message: 'Pendaftaran ditolak', pendaftaran: updated });
  } catch (error) {
    console.error('Reject pendaftaran error:', error);
    res.status(500).json({ error: 'Gagal menolak pendaftaran', detail: error.message });
  }
}
