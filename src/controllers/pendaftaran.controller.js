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
        user: { select: { id: true, name: true, email: true, phone: true } },
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
    const { kejurdaId, pengcabId, namaAtlet, kategori, kelasTanding, catatanPeserta } = req.body;
    let dataPersyaratan = req.body.dataPersyaratan ? JSON.parse(req.body.dataPersyaratan) : {};

    // Handle file uploads
    if (req.files) {
      if (req.files.buktiPembayaran && req.files.buktiPembayaran[0]) {
        dataPersyaratan.buktiPembayaran = `/uploads/${req.files.buktiPembayaran[0].filename}`;
      }
      if (req.files.buktiDP && req.files.buktiDP[0]) {
        dataPersyaratan.buktiDP = `/uploads/${req.files.buktiDP[0].filename}`;
      }
    }

    const dokumen = req.files?.dokumen?.[0] ? `/uploads/${req.files.dokumen[0].filename}` : null;

    // Cek apakah kejurda masih buka
    const kejurda = await prisma.kejurda.findUnique({ where: { id: parseInt(kejurdaId) } });
    if (!kejurda || !kejurda.statusBuka) {
      return res.status(400).json({ error: 'Event tidak ditemukan atau pendaftaran sudah ditutup' });
    }

    // Validasi user exists
    const userExists = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!userExists) {
      return res.status(401).json({ error: 'Sesi tidak valid. Silakan logout dan login kembali.' });
    }

    const pendaftaran = await prisma.pendaftaranKejurda.create({
      data: {
        kejurdaId: parseInt(kejurdaId),
        userId: req.user.id,
        pengcabId: pengcabId ? parseInt(pengcabId) : null,
        namaAtlet,
        kategori: kategori || 'Umum',
        kelasTanding,
        dokumen,
        dataPersyaratan: Object.keys(dataPersyaratan).length > 0 ? dataPersyaratan : undefined,
        catatanPeserta: catatanPeserta || null,
        guestEmail: req.body.guestEmail || null,
        guestPhone: req.body.guestPhone || null,
      },
      include: {
        kejurda: { select: { id: true, namaKejurda: true, jenisEvent: true } },
        pengcab: { select: { id: true, nama: true } }
      }
    });
    res.status(201).json({ message: 'Pendaftaran berhasil', pendaftaran });
  } catch (error) {
    console.error('Pendaftaran error:', error);
    res.status(500).json({ error: 'Gagal mendaftar', detail: error.message });
  }
};

const { randomUUID } = require('crypto');

const updateStatus = async (req, res) => {
  try {
    const { status, catatanAdmin } = req.body;
    
    // Generate QR token when approving
    const data = { status, catatanAdmin };
    if (status === 'DISETUJUI') {
      // Check if already has a token
      const existing = await prisma.pendaftaranKejurda.findUnique({ where: { id: parseInt(req.params.id) } });
      if (!existing?.qrToken) {
        data.qrToken = randomUUID();
      }
    }
    
    const pendaftaran = await prisma.pendaftaranKejurda.update({
      where: { id: parseInt(req.params.id) },
      data
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

// Upload pelunasan (for DP registrations)
const uploadPelunasan = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const pendaftaran = await prisma.pendaftaranKejurda.findUnique({ where: { id } });
    if (!pendaftaran) return res.status(404).json({ error: 'Data tidak ditemukan' });

    // Only owner can upload pelunasan
    if (pendaftaran.userId !== req.user.id && req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Akses ditolak' });
    }

    const dp = pendaftaran.dataPersyaratan || {};
    if (!dp.isBookingDP) {
      return res.status(400).json({ error: 'Pendaftaran ini bukan DP, tidak perlu pelunasan' });
    }
    if (dp.statusPembayaran === 'LUNAS') {
      return res.status(400).json({ error: 'Pelunasan sudah dilakukan sebelumnya' });
    }
    if (dp.statusPembayaran === 'MENUNGGU_VERIFIKASI') {
      return res.status(400).json({ error: 'Pelunasan sedang dalam proses verifikasi' });
    }

    const { nominalPelunasan } = req.body;
    if (!nominalPelunasan || parseInt(nominalPelunasan) <= 0) {
      return res.status(400).json({ error: 'Nominal pelunasan harus diisi' });
    }

    // Validate exact nominal match with sisa bayar
    const sisaBayar = (dp.nominalPembayaran || 0) - (dp.nominalDP || dp.nominalBayar || 0);
    if (parseInt(nominalPelunasan) !== sisaBayar) {
      return res.status(400).json({ error: `Nominal pelunasan harus tepat Rp ${sisaBayar.toLocaleString('id-ID')}. Tidak boleh kurang atau lebih.` });
    }

    let buktiPelunasanPath = null;
    if (req.files?.buktiPelunasan?.[0]) {
      buktiPelunasanPath = `/uploads/${req.files.buktiPelunasan[0].filename}`;
    } else {
      return res.status(400).json({ error: 'Upload bukti pelunasan diperlukan' });
    }

    // Update dataPersyaratan with pelunasan info
    const updatedDP = {
      ...dp,
      statusPembayaran: 'MENUNGGU_VERIFIKASI',
      nominalPelunasan: parseInt(nominalPelunasan),
      buktiPelunasan: buktiPelunasanPath,
      tanggalPelunasan: new Date().toISOString(),
      totalDibayar: (dp.nominalBayar || dp.nominalDP || 0) + parseInt(nominalPelunasan),
    };

    const updated = await prisma.pendaftaranKejurda.update({
      where: { id },
      data: { dataPersyaratan: updatedDP },
    });

    res.json({ message: 'Bukti pelunasan berhasil diupload. Menunggu verifikasi admin.', pendaftaran: updated });
  } catch (error) {
    console.error('Pelunasan error:', error);
    res.status(500).json({ error: 'Gagal upload pelunasan', detail: error.message });
  }
};

// Admin: verify pelunasan → mark as LUNAS + approve
const verifyPelunasan = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const pendaftaran = await prisma.pendaftaranKejurda.findUnique({ where: { id } });
    if (!pendaftaran) return res.status(404).json({ error: 'Data tidak ditemukan' });

    const dp = pendaftaran.dataPersyaratan || {};
    const updatedDP = {
      ...dp,
      statusPembayaran: 'LUNAS',
      verifiedAt: new Date().toISOString(),
    };

    // Generate QR token if not exists
    const updateData = {
      dataPersyaratan: updatedDP,
      status: 'DISETUJUI',
      catatanAdmin: req.body.catatan || 'Pelunasan diverifikasi',
    };
    if (!pendaftaran.qrToken) {
      updateData.qrToken = randomUUID();
    }

    const updated = await prisma.pendaftaranKejurda.update({
      where: { id },
      data: updateData,
    });

    res.json({ message: 'Pelunasan diverifikasi, pendaftaran disetujui', pendaftaran: updated });
  } catch (error) {
    res.status(500).json({ error: 'Gagal verifikasi', detail: error.message });
  }
};

// Verify QR code at venue entrance
const verifyQr = async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) return res.status(400).json({ error: 'Token QR tidak ditemukan' });

    const pendaftaran = await prisma.pendaftaranKejurda.findUnique({
      where: { qrToken: token },
      include: {
        kejurda: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });

    if (!pendaftaran) {
      return res.status(404).json({ valid: false, error: 'QR Code tidak valid atau tidak ditemukan' });
    }

    if (pendaftaran.status !== 'DISETUJUI') {
      return res.status(400).json({ valid: false, error: `Pendaftaran berstatus: ${pendaftaran.status}`, pendaftaran });
    }

    res.json({
      valid: true,
      message: 'QR Code valid - Peserta terdaftar',
      pendaftaran: {
        id: pendaftaran.id,
        namaAtlet: pendaftaran.namaAtlet,
        kategori: pendaftaran.kategori,
        status: pendaftaran.status,
        guestEmail: pendaftaran.guestEmail,
        guestPhone: pendaftaran.guestPhone,
        event: pendaftaran.kejurda?.namaKejurda,
        lokasi: pendaftaran.kejurda?.lokasi,
        tanggalMulai: pendaftaran.kejurda?.tanggalMulai,
        user: pendaftaran.user,
        dataPersyaratan: pendaftaran.dataPersyaratan,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal verifikasi QR', detail: error.message });
  }
};

// Admin: reject pelunasan → set statusPembayaran back to DITOLAK_PELUNASAN with catatan
const rejectPelunasan = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const pendaftaran = await prisma.pendaftaranKejurda.findUnique({ where: { id } });
    if (!pendaftaran) return res.status(404).json({ error: 'Data tidak ditemukan' });

    const dp = pendaftaran.dataPersyaratan || {};
    if (dp.statusPembayaran !== 'MENUNGGU_VERIFIKASI') {
      return res.status(400).json({ error: 'Tidak ada pelunasan yang perlu direview' });
    }

    const updatedDP = {
      ...dp,
      statusPembayaran: 'DITOLAK_PELUNASAN',
      catatanPelunasan: req.body.catatan || 'Pelunasan ditolak oleh admin',
      rejectedAt: new Date().toISOString(),
    };

    const updated = await prisma.pendaftaranKejurda.update({
      where: { id },
      data: { dataPersyaratan: updatedDP },
    });

    res.json({ message: 'Pelunasan ditolak', pendaftaran: updated });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menolak pelunasan', detail: error.message });
  }
};

module.exports = { getAll, getById, create, updateStatus, remove, uploadPelunasan, verifyPelunasan, rejectPelunasan, verifyQr };
