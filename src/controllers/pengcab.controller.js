const prisma = require('../lib/prisma');
const { fetchPengcabFromForbasi, mapForbasiToPengcab } = require('../lib/forbasi');

const getAll = async (req, res) => {
  try {
    const { search, status } = req.query;
    const where = {};
    if (search) {
      where.OR = [
        { nama: { contains: search } },
        { kota: { contains: search } },
        { ketua: { contains: search } }
      ];
    }
    if (status) where.status = status;

    const pengcab = await prisma.pengcab.findMany({
      where,
      orderBy: { nama: 'asc' },
      include: {
        _count: {
          select: { rekomendasiEvents: true, pendaftaranKejurda: true }
        }
      }
    });
    res.json(pengcab);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data pengcab', detail: error.message });
  }
};

const getById = async (req, res) => {
  try {
    const pengcab = await prisma.pengcab.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        rekomendasiEvents: { take: 5, orderBy: { createdAt: 'desc' } },
        pendaftaranKejurda: { take: 5, orderBy: { createdAt: 'desc' } }
      }
    });
    if (!pengcab) return res.status(404).json({ error: 'Pengcab tidak ditemukan' });
    res.json(pengcab);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data pengcab', detail: error.message });
  }
};

const create = async (req, res) => {
  try {
    const { nama, kota, ketua, sekretaris, bendahara, alamat, phone, email } = req.body;
    const logo = req.file ? `/uploads/${req.file.filename}` : null;

    const pengcab = await prisma.pengcab.create({
      data: { nama, kota, ketua, sekretaris, bendahara, alamat, phone, email, logo }
    });
    res.status(201).json({ message: 'Pengcab berhasil ditambahkan', pengcab });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menambah pengcab', detail: error.message });
  }
};

const update = async (req, res) => {
  try {
    const { nama, kota, ketua, sekretaris, bendahara, alamat, phone, email, status } = req.body;
    const data = { nama, kota, ketua, sekretaris, bendahara, alamat, phone, email, status };
    if (req.file) data.logo = `/uploads/${req.file.filename}`;

    const pengcab = await prisma.pengcab.update({
      where: { id: parseInt(req.params.id) },
      data
    });
    res.json({ message: 'Pengcab berhasil diupdate', pengcab });
  } catch (error) {
    res.status(500).json({ error: 'Gagal update pengcab', detail: error.message });
  }
};

const remove = async (req, res) => {
  try {
    await prisma.pengcab.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ message: 'Pengcab berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menghapus pengcab', detail: error.message });
  }
};

/**
 * Sync pengcab data from FORBASI API (forbasi.or.id)
 * - Creates new pengcab entries that don't exist yet (matched by forbasiId)
 * - Updates existing pengcab entries
 */
const syncFromForbasi = async (req, res) => {
  try {
    const apiResult = await fetchPengcabFromForbasi();
    const apiData = apiResult.data;

    let created = 0;
    let updated = 0;
    let errors = [];

    for (const item of apiData) {
      const mapped = mapForbasiToPengcab(item);

      try {
        const existing = await prisma.pengcab.findUnique({
          where: { forbasiId: mapped.forbasiId }
        });

        if (existing) {
          await prisma.pengcab.update({
            where: { forbasiId: mapped.forbasiId },
            data: {
              nama: mapped.nama,
              kota: mapped.kota,
              email: mapped.email,
              phone: mapped.phone,
              username: mapped.username,
              status: mapped.status,
            }
          });
          updated++;
        } else {
          await prisma.pengcab.create({
            data: mapped
          });
          created++;
        }
      } catch (err) {
        errors.push({ forbasiId: item.id, club_name: item.club_name, error: err.message });
      }
    }

    res.json({
      message: `Sync selesai. ${created} baru, ${updated} diupdate.`,
      totalFromApi: apiResult.total,
      created,
      updated,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal sync dari FORBASI API', detail: error.message });
  }
};

module.exports = { getAll, getById, create, update, remove, syncFromForbasi };
