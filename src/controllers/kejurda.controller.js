const prisma = require('../lib/prisma');
const { generateSuratRekomendasi } = require('../lib/suratGenerator');

// Helper: convert month number to Roman numeral
function toRoman(num) {
  const romans = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  return romans[num] || String(num);
}

// Generate auto nomor surat for Kejurcab: UM.001/FORBASI-JABAR/II/2026
async function generateNomorSuratKejurcab() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const romanMonth = toRoman(month);

  // Count approved kejurcab + rekomendasi this year
  const startOfYear = new Date(year, 0, 1);
  const endOfYear = new Date(year + 1, 0, 1);

  // Count from both tables
  const [rekCount, kejCount] = await Promise.all([
    prisma.rekomendasiEvent.count({
      where: {
        nomorSurat: { not: null },
        approvedPengdaAt: { gte: startOfYear, lt: endOfYear },
      },
    }),
    prisma.kejurda.count({
      where: {
        nomorSurat: { not: null },
        statusApproval: 'DISETUJUI',
        updatedAt: { gte: startOfYear, lt: endOfYear },
      },
    }),
  ]);

  const seq = String(rekCount + kejCount + 1).padStart(3, '0');
  return `UM.${seq}/FORBASI-JABAR/${romanMonth}/${year}`;
}

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
        pengcabPengaju: { select: { id: true, nama: true, kota: true, email: true, phone: true } },
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
    const { namaKejurda, tanggalMulai, tanggalSelesai, lokasi, deskripsi, jenisEvent, targetPeserta } = req.body;
    const jenis = jenisEvent || 'KEJURDA';
    const target = targetPeserta || 'CLUB';
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

    const earlyBird = req.body.earlyBirdAktif !== undefined ? (req.body.earlyBirdAktif === 'true' || req.body.earlyBirdAktif === true) : true;

    const kejurda = await prisma.kejurda.create({
      data: {
        namaKejurda,
        jenisEvent: jenis,
        targetPeserta: target,
        tanggalMulai: new Date(tanggalMulai),
        tanggalSelesai: new Date(tanggalSelesai),
        lokasi, deskripsi, poster,
        earlyBirdAktif: earlyBird,
      }
    });
    res.status(201).json({ message: 'Event berhasil dibuat', kejurda });
  } catch (error) {
    res.status(500).json({ error: 'Gagal membuat event', detail: error.message });
  }
};

const updateKejurda = async (req, res) => {
  try {
    const { namaKejurda, tanggalMulai, tanggalSelesai, lokasi, deskripsi, statusBuka, jenisEvent, targetPeserta } = req.body;
    const data = { namaKejurda, lokasi, deskripsi };
    if (jenisEvent) data.jenisEvent = jenisEvent;
    if (targetPeserta) data.targetPeserta = targetPeserta;
    if (tanggalMulai) data.tanggalMulai = new Date(tanggalMulai);
    if (tanggalSelesai) data.tanggalSelesai = new Date(tanggalSelesai);
    if (statusBuka !== undefined) data.statusBuka = statusBuka === 'true' || statusBuka === true;
    if (req.body.earlyBirdAktif !== undefined) data.earlyBirdAktif = req.body.earlyBirdAktif === 'true' || req.body.earlyBirdAktif === true;
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
      orderBy: { tanggalMulai: 'asc' },
      include: {
        pengcabPengaju: { select: { id: true, nama: true, kota: true } }
      }
    });
    res.json(kejurda);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data event', detail: error.message });
  }
};

// Quick toggle early bird
const toggleEarlyBird = async (req, res) => {
  try {
    const kejurda = await prisma.kejurda.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!kejurda) return res.status(404).json({ error: 'Event tidak ditemukan' });
    const updated = await prisma.kejurda.update({
      where: { id: kejurda.id },
      data: { earlyBirdAktif: !kejurda.earlyBirdAktif }
    });
    res.json({ message: `Early Bird ${updated.earlyBirdAktif ? 'diaktifkan' : 'dinonaktifkan'}`, kejurda: updated });
  } catch (error) {
    res.status(500).json({ error: 'Gagal toggle early bird', detail: error.message });
  }
};

// Quick toggle registration open/close
const toggleRegistration = async (req, res) => {
  try {
    const kejurda = await prisma.kejurda.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!kejurda) return res.status(404).json({ error: 'Event tidak ditemukan' });
    const updated = await prisma.kejurda.update({
      where: { id: kejurda.id },
      data: { statusBuka: !kejurda.statusBuka }
    });
    res.json({ message: `Pendaftaran ${updated.statusBuka ? 'dibuka' : 'ditutup'}`, kejurda: updated });
  } catch (error) {
    res.status(500).json({ error: 'Gagal toggle pendaftaran', detail: error.message });
  }
};

module.exports = { getAllKejurda, getKejurdaById, createKejurda, updateKejurda, removeKejurda, getOpenKejurda, approveKejurda, rejectKejurda, toggleEarlyBird, toggleRegistration, generateSuratKejurcab };

// ========= Admin Approval for Pengcab-submitted Kejurcab =========
async function approveKejurda(req, res) {
  try {
    const kejurda = await prisma.kejurda.findUnique({ 
      where: { id: parseInt(req.params.id) },
      include: { pengcabPengaju: { select: { id: true, nama: true, kota: true } } }
    });
    if (!kejurda) return res.status(404).json({ error: 'Event tidak ditemukan' });
    if (kejurda.statusApproval !== 'PENDING') {
      return res.status(400).json({ error: 'Event ini sudah diproses sebelumnya' });
    }

    // Generate nomor surat
    const nomorSurat = await generateNomorSuratKejurcab();

    const updated = await prisma.kejurda.update({
      where: { id: kejurda.id },
      data: {
        statusApproval: 'DISETUJUI',
        statusBuka: true,
        catatanAdmin: req.body.catatan || null,
        nomorSurat,
      },
      include: { pengcabPengaju: { select: { id: true, nama: true, kota: true } } }
    });

    // Generate surat rekomendasi PDF
    try {
      // Map Kejurda fields to RekomendasiEvent format for PDF generator
      const mappedEvent = {
        id: updated.id,
        namaEvent: updated.namaKejurda,
        jenisEvent: updated.jenisEvent,
        tanggalMulai: updated.tanggalMulai,
        tanggalSelesai: updated.tanggalSelesai,
        lokasi: updated.lokasi,
        penyelenggara: updated.pengcabPengaju?.nama || 'Pengcab',
        nomorSurat: updated.nomorSurat,
        pengcab: updated.pengcabPengaju,
      };

      const suratPath = await generateSuratRekomendasi(mappedEvent);
      await prisma.kejurda.update({
        where: { id: updated.id },
        data: { suratRekomendasi: suratPath }
      });
      updated.suratRekomendasi = suratPath;
    } catch (pdfErr) {
      console.error('Gagal generate surat rekomendasi Kejurcab:', pdfErr.message);
      // Don't fail the approval, just log the error
    }

    res.json({ message: 'Pengajuan Kejurcab disetujui', kejurcab: updated });
  } catch (error) {
    console.error('Approve kejurcab error:', error);
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
    res.json({ message: 'Pengajuan Kejurcab ditolak', kejurcab: updated });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menolak', detail: error.message });
  }
}

// Generate or regenerate surat rekomendasi for approved Kejurcab
async function generateSuratKejurcab(req, res) {
  try {
    const kejurda = await prisma.kejurda.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { pengcabPengaju: { select: { id: true, nama: true, kota: true } } }
    });
    
    if (!kejurda) return res.status(404).json({ error: 'Event tidak ditemukan' });
    if (kejurda.statusApproval !== 'DISETUJUI') {
      return res.status(400).json({ error: 'Hanya event yang sudah disetujui yang bisa generate surat' });
    }

    // Generate nomor surat if not exists
    let nomorSurat = kejurda.nomorSurat;
    if (!nomorSurat) {
      nomorSurat = await generateNomorSuratKejurcab();
      await prisma.kejurda.update({
        where: { id: kejurda.id },
        data: { nomorSurat }
      });
    }

    // Map Kejurda fields to RekomendasiEvent format for PDF generator
    const mappedEvent = {
      id: kejurda.id,
      namaEvent: kejurda.namaKejurda,
      jenisEvent: kejurda.jenisEvent,
      tanggalMulai: kejurda.tanggalMulai,
      tanggalSelesai: kejurda.tanggalSelesai,
      lokasi: kejurda.lokasi,
      penyelenggara: kejurda.pengcabPengaju?.nama || 'Pengcab',
      nomorSurat: nomorSurat,
      pengcab: kejurda.pengcabPengaju,
    };

    const suratPath = await generateSuratRekomendasi(mappedEvent);
    
    const updated = await prisma.kejurda.update({
      where: { id: kejurda.id },
      data: { suratRekomendasi: suratPath },
      include: { pengcabPengaju: { select: { id: true, nama: true, kota: true } } }
    });

    res.json({ message: 'Surat rekomendasi berhasil digenerate', kejurcab: updated });
  } catch (error) {
    console.error('Generate surat kejurcab error:', error);
    res.status(500).json({ error: 'Gagal generate surat', detail: error.message });
  }
}
