const prisma = require('../lib/prisma');
const { generateSuratRekomendasi } = require('../lib/suratGenerator');

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

// Helper: parse form body and files into a data object
const parseFormData = (req) => {
  const { namaEvent, jenisEvent, tanggalMulai, tanggalSelesai, lokasi, deskripsi, penyelenggara, kontakPerson, noBilingSimpaskor, pengcabId, mataLomba: mataLombaRaw, submitAction } = req.body;

  let mataLomba = null;
  if (mataLombaRaw) {
    try { mataLomba = JSON.parse(mataLombaRaw); } catch { mataLomba = null; }
  }

  const files = req.files || [];
  const dokumenSuratFile = files.find(f => f.fieldname === 'dokumenSurat');
  const dokumenSurat = dokumenSuratFile ? `/uploads/${dokumenSuratFile.filename}` : null;

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
  }

  return { namaEvent, jenisEvent, tanggalMulai, tanggalSelesai, lokasi, deskripsi, penyelenggara, kontakPerson, noBilingSimpaskor, pengcabId, mataLomba, dokumenSurat, persyaratan, submitAction };
};

const create = async (req, res) => {
  try {
    const parsed = parseFormData(req);
    const isDraft = parsed.submitAction === 'draft';

    if (!isDraft) {
      if (!parsed.namaEvent) return res.status(400).json({ error: 'Nama event wajib diisi' });
      if (!parsed.noBilingSimpaskor?.trim()) return res.status(400).json({ error: 'No. Billing Simpaskor wajib diisi' });
    }

    let finalPengcabId = parsed.pengcabId ? parseInt(parsed.pengcabId) : null;
    if (!finalPengcabId) {
      const userProfile = await prisma.user.findUnique({ where: { id: req.user.id }, select: { pengcabId: true } });
      if (userProfile?.pengcabId) finalPengcabId = userProfile.pengcabId;
    }

    const event = await prisma.rekomendasiEvent.create({
      data: {
        namaEvent: parsed.namaEvent,
        jenisEvent: parsed.jenisEvent || null,
        tanggalMulai: parsed.tanggalMulai ? new Date(parsed.tanggalMulai) : null,
        tanggalSelesai: parsed.tanggalSelesai ? new Date(parsed.tanggalSelesai) : null,
        lokasi: parsed.lokasi || null,
        deskripsi: parsed.deskripsi || null,
        penyelenggara: parsed.penyelenggara || null,
        kontakPerson: parsed.kontakPerson || null,
        noBilingSimpaskor: parsed.noBilingSimpaskor || null,
        dokumenSurat: parsed.dokumenSurat,
        persyaratan: parsed.persyaratan || undefined,
        mataLomba: parsed.mataLomba || undefined,
        status: isDraft ? 'DRAFT' : 'PENDING',
        userId: req.user.id,
        pengcabId: finalPengcabId
      },
      include: {
        user: { select: { id: true, name: true } },
        pengcab: { select: { id: true, nama: true } }
      }
    });
    res.status(201).json({
      message: isDraft ? 'Draft berhasil disimpan' : 'Permohonan rekomendasi berhasil diajukan',
      event
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengajukan rekomendasi', detail: error.message });
  }
};

const update = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.rekomendasiEvent.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Data tidak ditemukan' });

    // Only owner can edit
    if (req.user.role !== 'ADMIN' && existing.userId !== req.user.id) {
      return res.status(403).json({ error: 'Akses ditolak' });
    }

    // Can only edit DRAFT or DITOLAK
    if (!['DRAFT', 'DITOLAK'].includes(existing.status)) {
      return res.status(400).json({ error: 'Hanya event berstatus Draft atau Ditolak yang bisa diedit' });
    }

    const parsed = parseFormData(req);
    const isDraft = parsed.submitAction === 'draft';

    if (!isDraft) {
      if (!(parsed.namaEvent || existing.namaEvent)) return res.status(400).json({ error: 'Nama event wajib diisi' });
      if (!(parsed.noBilingSimpaskor?.trim() || existing.noBilingSimpaskor?.trim())) return res.status(400).json({ error: 'No. Billing Simpaskor wajib diisi' });
    }

    let finalPengcabId = parsed.pengcabId ? parseInt(parsed.pengcabId) : existing.pengcabId;

    const data = {
      namaEvent: parsed.namaEvent || existing.namaEvent,
      jenisEvent: parsed.jenisEvent || existing.jenisEvent,
      tanggalMulai: parsed.tanggalMulai ? new Date(parsed.tanggalMulai) : existing.tanggalMulai,
      tanggalSelesai: parsed.tanggalSelesai ? new Date(parsed.tanggalSelesai) : existing.tanggalSelesai,
      lokasi: parsed.lokasi || existing.lokasi,
      deskripsi: parsed.deskripsi ?? existing.deskripsi,
      penyelenggara: parsed.penyelenggara || existing.penyelenggara,
      kontakPerson: parsed.kontakPerson ?? existing.kontakPerson,
      noBilingSimpaskor: parsed.noBilingSimpaskor ?? existing.noBilingSimpaskor,
      pengcabId: finalPengcabId,
      status: isDraft ? 'DRAFT' : 'PENDING',
    };

    // Only update file fields if new ones provided
    if (parsed.dokumenSurat) data.dokumenSurat = parsed.dokumenSurat;
    if (parsed.persyaratan) data.persyaratan = parsed.persyaratan;
    if (parsed.mataLomba) data.mataLomba = parsed.mataLomba;

    // Reset approval fields when resubmitting
    if (!isDraft) {
      data.catatanPengcab = null;
      data.catatanAdmin = null;
      data.approvedPengcabAt = null;
      data.approvedPengdaAt = null;
    }

    const event = await prisma.rekomendasiEvent.update({
      where: { id },
      data,
      include: {
        user: { select: { id: true, name: true } },
        pengcab: { select: { id: true, nama: true } }
      }
    });

    res.json({
      message: isDraft ? 'Draft berhasil disimpan' : 'Permohonan berhasil diajukan ulang',
      event
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengupdate data', detail: error.message });
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
      if (!catatanAdmin?.trim()) return res.status(400).json({ error: 'Catatan alasan penolakan wajib diisi' });
      data.catatanAdmin = catatanAdmin.trim();
      if (catatanPengcab) data.catatanPengcab = catatanPengcab;
    }

    const event = await prisma.rekomendasiEvent.update({
      where: { id: parseInt(req.params.id) },
      data,
      include: {
        user: { select: { id: true, name: true, email: true } },
        pengcab: { select: { id: true, nama: true, kota: true } }
      }
    });

    // Generate surat rekomendasi PDF when approved (DISETUJUI)
    if (status === 'DISETUJUI') {
      try {
        const suratPath = await generateSuratRekomendasi(event);
        await prisma.rekomendasiEvent.update({
          where: { id: event.id },
          data: { suratRekomendasi: suratPath }
        });
        event.suratRekomendasi = suratPath;
      } catch (pdfErr) {
        console.error('Gagal generate surat rekomendasi:', pdfErr.message);
        // Don't fail the approval, just log the error
      }
    }

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

module.exports = { getAll, getById, create, update, updateStatus, remove };
