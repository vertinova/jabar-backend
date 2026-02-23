const prisma = require('../lib/prisma');

// Get all categories (public — used by frontend for tabs)
const getAll = async (req, res) => {
  try {
    const where = {};
    if (req.query.aktif !== undefined) where.aktif = req.query.aktif === 'true';
    const kategori = await prisma.kategoriEvent.findMany({
      where,
      orderBy: [{ grup: 'asc' }, { urutan: 'asc' }, { nama: 'asc' }],
    });
    res.json(kategori);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data kategori', detail: error.message });
  }
};

// Create category (admin only)
const create = async (req, res) => {
  try {
    const { kode, nama, warna, grup, urutan } = req.body;
    if (!kode || !nama) {
      return res.status(400).json({ error: 'Kode dan nama kategori wajib diisi' });
    }

    const existing = await prisma.kategoriEvent.findUnique({ where: { kode: kode.toUpperCase() } });
    if (existing) {
      return res.status(400).json({ error: `Kode "${kode}" sudah digunakan` });
    }

    const kategori = await prisma.kategoriEvent.create({
      data: {
        kode: kode.toUpperCase().replace(/\s+/g, '_'),
        nama,
        warna: warna || 'green',
        grup: grup || 'kegiatan',
        urutan: urutan !== undefined ? parseInt(urutan) : 0,
      },
    });
    res.status(201).json({ message: 'Kategori berhasil dibuat', kategori });
  } catch (error) {
    res.status(500).json({ error: 'Gagal membuat kategori', detail: error.message });
  }
};

// Update category (admin only)
const update = async (req, res) => {
  try {
    const { id } = req.params;
    const { nama, warna, grup, urutan, aktif } = req.body;

    const kategori = await prisma.kategoriEvent.findUnique({ where: { id: parseInt(id) } });
    if (!kategori) return res.status(404).json({ error: 'Kategori tidak ditemukan' });

    const data = {};
    if (nama !== undefined) data.nama = nama;
    if (warna !== undefined) data.warna = warna;
    if (grup !== undefined) data.grup = grup;
    if (urutan !== undefined) data.urutan = parseInt(urutan);
    if (aktif !== undefined) data.aktif = aktif === true || aktif === 'true';

    const updated = await prisma.kategoriEvent.update({
      where: { id: parseInt(id) },
      data,
    });
    res.json({ message: 'Kategori berhasil diupdate', kategori: updated });
  } catch (error) {
    res.status(500).json({ error: 'Gagal update kategori', detail: error.message });
  }
};

// Delete category (admin only)
const remove = async (req, res) => {
  try {
    const { id } = req.params;

    const kategori = await prisma.kategoriEvent.findUnique({ where: { id: parseInt(id) } });
    if (!kategori) return res.status(404).json({ error: 'Kategori tidak ditemukan' });

    // Check if any events use this category
    const eventCount = await prisma.kejurda.count({ where: { jenisEvent: kategori.kode } });
    if (eventCount > 0) {
      return res.status(400).json({
        error: `Tidak dapat menghapus — ${eventCount} event menggunakan kategori "${kategori.nama}". Nonaktifkan saja jika tidak ingin ditampilkan.`,
      });
    }

    await prisma.kategoriEvent.delete({ where: { id: parseInt(id) } });
    res.json({ message: 'Kategori berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menghapus kategori', detail: error.message });
  }
};

module.exports = { getAll, create, update, remove };
