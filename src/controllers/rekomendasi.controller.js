const prisma = require('../lib/prisma');

const getAll = async (req, res) => {
  try {
    const { search, status } = req.query;
    const where = {};
    
    // Only ADMIN sees all, PENYELENGGARA sees own only
    if (req.user.role !== 'ADMIN') {
      where.userId = req.user.id;
    }
    if (search) {
      where.OR = [
        { namaEvent: { contains: search } },
        { penyelenggara: { contains: search } },
        { lokasi: { contains: search } }
      ];
    }
    if (status) where.status = status;

    const events = await prisma.rekomendasiEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true } },
        pengcab: { select: { id: true, nama: true, kota: true } }
      }
    });
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data rekomendasi', detail: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const event = await prisma.rekomendasiEvent.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        pengcab: { select: { id: true, nama: true, kota: true } }
      }
    });
    if (!event) return res.status(404).json({ error: 'Data tidak ditemukan' });
    
    // Non-admin hanya bisa lihat milik sendiri
    if (req.user.role !== 'ADMIN' && event.userId !== req.user.id) {
      return res.status(403).json({ error: 'Akses ditolak' });
    }
    
    res.json(event);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data', detail: error.message });
  }
};

const create = async (req, res) => {
  try {
    const { namaEvent, jenisEvent, tanggalMulai, tanggalSelesai, lokasi, deskripsi, penyelenggara, kontakPerson, pengcabId, mataLomba: mataLombaRaw } = req.body;

    // Parse mataLomba JSON
    let mataLomba = null;
    if (mataLombaRaw) {
      try { mataLomba = JSON.parse(mataLombaRaw); } catch { mataLomba = null; }
    }
    
    // Handle dokumenSurat from uploaded files
    const files = req.files || [];
    const dokumenSuratFile = files.find(f => f.fieldname === 'dokumenSurat');
    const dokumenSurat = dokumenSuratFile ? `/uploads/${dokumenSuratFile.filename}` : null;

    // Build persyaratan JSON from form data and uploaded files
    let persyaratan = null;
    if (req.body.persyaratan) {
      try {
        persyaratan = JSON.parse(req.body.persyaratan);
      } catch { persyaratan = {}; }
      
      // Map uploaded files to persyaratan paths
      const fileFields = [
        'suratIzinSekolah', 'suratIzinKepolisian', 'suratRekomendasiDinas',
        'suratIzinVenue', 'suratRekomendasiPPI',
        'fotoLapangan', 'fotoTempatIbadah', 'fotoBarak', 'fotoAreaParkir',
        'fotoRuangKesehatan', 'fotoMCK', 'fotoTempatSampah', 'fotoRuangKomisi',
        'faktaIntegritasKomisi', 'faktaIntegritasHonor',
        'desainSertifikat'
      ];
      
      for (const field of fileFields) {
        const uploadedFile = files.find(f => f.fieldname === field);
        if (uploadedFile) {
          // Store file path in persyaratan JSON
          if (!persyaratan[field]) persyaratan[field] = {};
          if (typeof persyaratan[field] === 'object') {
            persyaratan[field].file = `/uploads/${uploadedFile.filename}`;
          }
        }
      }
    }

    // Auto-assign pengcab from user profile if not provided
    let finalPengcabId = pengcabId ? parseInt(pengcabId) : null;
    if (!finalPengcabId) {
      const userProfile = await prisma.user.findUnique({ where: { id: req.user.id }, select: { pengcabId: true } });
      if (userProfile?.pengcabId) finalPengcabId = userProfile.pengcabId;
    }

    const event = await prisma.rekomendasiEvent.create({
      data: {
        namaEvent, jenisEvent,
        tanggalMulai: new Date(tanggalMulai),
        tanggalSelesai: new Date(tanggalSelesai),
        lokasi, deskripsi, penyelenggara, kontakPerson, dokumenSurat,
        persyaratan: persyaratan || undefined,
        mataLomba: mataLomba || undefined,
        userId: req.user.id,
        pengcabId: finalPengcabId
      },
      include: {
        user: { select: { id: true, name: true } },
        pengcab: { select: { id: true, nama: true } }
      }
    });
    res.status(201).json({ message: 'Permohonan rekomendasi berhasil diajukan', event });
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengajukan rekomendasi', detail: error.message });
  }
};

const updateStatus = async (req, res) => {
  try {
    const { status, catatanAdmin, catatanPengcab } = req.body;
    const data = { status };
    
    if (status === 'APPROVED_PENGCAB') {
      data.approvedPengcabAt = new Date();
      if (catatanPengcab) data.catatanPengcab = catatanPengcab;
    }
    if (status === 'DISETUJUI') {
      data.approvedPengdaAt = new Date();
      if (catatanAdmin) data.catatanAdmin = catatanAdmin;
    }
    if (status === 'DITOLAK') {
      if (catatanAdmin) data.catatanAdmin = catatanAdmin;
      if (catatanPengcab) data.catatanPengcab = catatanPengcab;
    }

    const event = await prisma.rekomendasiEvent.update({
      where: { id: parseInt(req.params.id) },
      data
    });
    res.json({ message: `Status rekomendasi diubah menjadi ${status}`, event });
  } catch (error) {
    res.status(500).json({ error: 'Gagal update status', detail: error.message });
  }
};

const remove = async (req, res) => {
  try {
    const event = await prisma.rekomendasiEvent.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!event) return res.status(404).json({ error: 'Data tidak ditemukan' });
    
    if (req.user.role !== 'ADMIN' && event.userId !== req.user.id) {
      return res.status(403).json({ error: 'Akses ditolak' });
    }

    await prisma.rekomendasiEvent.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ message: 'Data rekomendasi berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menghapus data', detail: error.message });
  }
};

module.exports = { getAll, getById, create, updateStatus, remove };
