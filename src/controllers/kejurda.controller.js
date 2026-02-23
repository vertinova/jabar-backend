const prisma = require('../lib/prisma');

// ========= KEJURDA (Admin) =========
const getAllKejurda = async (req, res) => {
  try {
    const kejurda = await prisma.kejurda.findMany({
      orderBy: { tanggalMulai: 'desc' },
      include: {
        _count: { select: { pendaftaran: true, persyaratanFields: true } },
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
        persyaratanFields: {
          where: { aktif: true },
          orderBy: { urutan: 'asc' }
        },
        pendaftaran: {
          include: {
            user: { select: { id: true, name: true, email: true, phone: true } },
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
    const { namaKejurda, tanggalMulai, tanggalSelesai, lokasi, deskripsi, jenisEvent, targetPeserta, biayaPendaftaran, batasPendaftaran, kontakPerson, kontakPhone } = req.body;
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
        targetPeserta: targetPeserta || 'CLUB',
        tanggalMulai: new Date(tanggalMulai),
        tanggalSelesai: new Date(tanggalSelesai),
        lokasi, 
        deskripsi, 
        poster,
        biayaPendaftaran: biayaPendaftaran ? parseFloat(biayaPendaftaran) : null,
        batasPendaftaran: batasPendaftaran ? new Date(batasPendaftaran) : null,
        kontakPerson,
        kontakPhone
      }
    });
    res.status(201).json({ message: 'Event berhasil dibuat', kejurda });
  } catch (error) {
    res.status(500).json({ error: 'Gagal membuat event', detail: error.message });
  }
};

const updateKejurda = async (req, res) => {
  try {
    const { namaKejurda, tanggalMulai, tanggalSelesai, lokasi, deskripsi, statusBuka, jenisEvent, targetPeserta, biayaPendaftaran, batasPendaftaran, kontakPerson, kontakPhone } = req.body;
    const data = { namaKejurda, lokasi, deskripsi, kontakPerson, kontakPhone };
    if (jenisEvent) data.jenisEvent = jenisEvent;
    if (targetPeserta) data.targetPeserta = targetPeserta;
    if (tanggalMulai) data.tanggalMulai = new Date(tanggalMulai);
    if (tanggalSelesai) data.tanggalSelesai = new Date(tanggalSelesai);
    if (statusBuka !== undefined) data.statusBuka = statusBuka === 'true' || statusBuka === true;
    if (biayaPendaftaran !== undefined) data.biayaPendaftaran = biayaPendaftaran ? parseFloat(biayaPendaftaran) : null;
    if (batasPendaftaran !== undefined) data.batasPendaftaran = batasPendaftaran ? new Date(batasPendaftaran) : null;
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
        persyaratanFields: {
          where: { aktif: true },
          orderBy: { urutan: 'asc' }
        }
      }
    });
    res.json(kejurda);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data event', detail: error.message });
  }
};

// Get single event for public registration
const getEventForRegistration = async (req, res) => {
  try {
    const kejurda = await prisma.kejurda.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        persyaratanFields: {
          where: { aktif: true },
          orderBy: { urutan: 'asc' }
        }
      }
    });
    if (!kejurda) return res.status(404).json({ error: 'Event tidak ditemukan' });
    if (!kejurda.statusBuka || kejurda.statusApproval !== 'DISETUJUI') {
      return res.status(400).json({ error: 'Pendaftaran event ini tidak dibuka' });
    }
    res.json(kejurda);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data event', detail: error.message });
  }
};

// ========= PERSYARATAN FIELDS CRUD =========
const getPersyaratanFields = async (req, res) => {
  try {
    const fields = await prisma.persyaratanField.findMany({
      where: { kejurdaId: parseInt(req.params.kejurdaId) },
      orderBy: { urutan: 'asc' }
    });
    res.json(fields);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data persyaratan', detail: error.message });
  }
};

const createPersyaratanField = async (req, res) => {
  try {
    const kejurdaId = parseInt(req.params.kejurdaId);
    const { label, tipe, required, options, keterangan, urutan } = req.body;
    
    // Get max urutan if not provided
    let fieldUrutan = urutan;
    if (fieldUrutan === undefined) {
      const maxUrutan = await prisma.persyaratanField.findFirst({
        where: { kejurdaId },
        orderBy: { urutan: 'desc' },
        select: { urutan: true }
      });
      fieldUrutan = (maxUrutan?.urutan || 0) + 1;
    }

    const field = await prisma.persyaratanField.create({
      data: {
        kejurdaId,
        label,
        tipe: tipe || 'TEXT',
        required: required !== false,
        options: options || null,
        keterangan,
        urutan: fieldUrutan
      }
    });
    res.status(201).json({ message: 'Field persyaratan berhasil ditambahkan', field });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menambahkan field', detail: error.message });
  }
};

const updatePersyaratanField = async (req, res) => {
  try {
    const { label, tipe, required, options, keterangan, urutan, aktif } = req.body;
    const data = {};
    if (label !== undefined) data.label = label;
    if (tipe !== undefined) data.tipe = tipe;
    if (required !== undefined) data.required = required;
    if (options !== undefined) data.options = options;
    if (keterangan !== undefined) data.keterangan = keterangan;
    if (urutan !== undefined) data.urutan = urutan;
    if (aktif !== undefined) data.aktif = aktif;

    const field = await prisma.persyaratanField.update({
      where: { id: parseInt(req.params.id) },
      data
    });
    res.json({ message: 'Field persyaratan berhasil diupdate', field });
  } catch (error) {
    res.status(500).json({ error: 'Gagal update field', detail: error.message });
  }
};

const deletePersyaratanField = async (req, res) => {
  try {
    await prisma.persyaratanField.delete({
      where: { id: parseInt(req.params.id) }
    });
    res.json({ message: 'Field persyaratan berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menghapus field', detail: error.message });
  }
};

// Reorder persyaratan fields
const reorderPersyaratanFields = async (req, res) => {
  try {
    const { fieldOrders } = req.body; // Array of { id, urutan }
    if (!Array.isArray(fieldOrders)) {
      return res.status(400).json({ error: 'fieldOrders harus berupa array' });
    }

    await Promise.all(
      fieldOrders.map(item => 
        prisma.persyaratanField.update({
          where: { id: item.id },
          data: { urutan: item.urutan }
        })
      )
    );
    res.json({ message: 'Urutan field berhasil diupdate' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengubah urutan', detail: error.message });
  }
};

module.exports = { 
  getAllKejurda, 
  getKejurdaById, 
  createKejurda, 
  updateKejurda, 
  removeKejurda, 
  getOpenKejurda, 
  getEventForRegistration,
  approveKejurda, 
  rejectKejurda,
  // Persyaratan fields
  getPersyaratanFields,
  createPersyaratanField,
  updatePersyaratanField,
  deletePersyaratanField,
  reorderPersyaratanFields
};

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
