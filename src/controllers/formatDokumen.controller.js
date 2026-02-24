const prisma = require('../lib/prisma');
const path = require('path');
const fs = require('fs');

// GET all format dokumen (public - for download modal)
const getAll = async (req, res) => {
  try {
    const { kategori } = req.query;
    const where = { aktif: true };
    if (kategori) where.kategori = kategori;

    const formats = await prisma.formatDokumen.findMany({
      where,
      orderBy: [{ kategori: 'asc' }, { urutan: 'asc' }, { nama: 'asc' }]
    });
    res.json(formats);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data format dokumen', detail: error.message });
  }
};

// GET all for admin (including non-aktif)
const getAllAdmin = async (req, res) => {
  try {
    const formats = await prisma.formatDokumen.findMany({
      orderBy: [{ kategori: 'asc' }, { urutan: 'asc' }, { nama: 'asc' }]
    });
    res.json(formats);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data', detail: error.message });
  }
};

// POST create format dokumen (admin only)
const create = async (req, res) => {
  try {
    const { nama, deskripsi, kategori, urutan } = req.body;
    if (!nama) return res.status(400).json({ error: 'Nama wajib diisi' });

    const file = req.file;
    if (!file) return res.status(400).json({ error: 'File wajib diupload' });

    const format = await prisma.formatDokumen.create({
      data: {
        nama,
        deskripsi: deskripsi || null,
        filePath: `/uploads/${file.filename}`,
        kategori: kategori || 'umum',
        urutan: urutan ? parseInt(urutan) : 0,
      }
    });
    res.status(201).json({ message: 'Format dokumen berhasil ditambahkan', format });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menambahkan format dokumen', detail: error.message });
  }
};

// PUT update format dokumen (admin only)
const update = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.formatDokumen.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Data tidak ditemukan' });

    const { nama, deskripsi, kategori, urutan, aktif } = req.body;
    const data = {};
    if (nama !== undefined) data.nama = nama;
    if (deskripsi !== undefined) data.deskripsi = deskripsi;
    if (kategori !== undefined) data.kategori = kategori;
    if (urutan !== undefined) data.urutan = parseInt(urutan);
    if (aktif !== undefined) data.aktif = aktif === 'true' || aktif === true;

    // If new file uploaded, replace old file
    const file = req.file;
    if (file) {
      data.filePath = `/uploads/${file.filename}`;
      // Delete old file
      const oldPath = path.join(__dirname, '..', '..', existing.filePath);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const format = await prisma.formatDokumen.update({ where: { id }, data });
    res.json({ message: 'Format dokumen berhasil diupdate', format });
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengupdate format dokumen', detail: error.message });
  }
};

// DELETE format dokumen (admin only)
const remove = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.formatDokumen.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Data tidak ditemukan' });

    // Delete file
    const filePath = path.join(__dirname, '..', '..', existing.filePath);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await prisma.formatDokumen.delete({ where: { id } });
    res.json({ message: 'Format dokumen berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menghapus format dokumen', detail: error.message });
  }
};

module.exports = { getAll, getAllAdmin, create, update, remove };
