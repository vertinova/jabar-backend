const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');

// Role yang boleh dikelola lewat panel ini. SUPERADMIN TIDAK boleh membuat/menyentuh
// akun ADMIN/SUPERADMIN/PENGCAB dll — hanya role non-privileged di daftar ini.
const MANAGEABLE_ROLES = ['KOMPER'];

const ROLE_LABELS = {
  KOMPER: 'Komisi Perlombaan',
};

const publicSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  phone: true,
  isKomperPic: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

// Daftar role yang tersedia untuk diberikan (dipakai frontend untuk dropdown).
const getRoles = async (_req, res) => {
  res.json(MANAGEABLE_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] || role })));
};

const listUsers = async (_req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: { role: { in: MANAGEABLE_ROLES } },
      select: publicSelect,
      orderBy: { createdAt: 'desc' },
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat daftar pengguna', detail: error.message });
  }
};

const createUser = async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = req.body.phone ? String(req.body.phone).trim() : null;
    const password = String(req.body.password || '');
    const role = String(req.body.role || '').trim();

    if (!name) return res.status(400).json({ error: 'Nama wajib diisi' });
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email tidak valid' });
    if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });
    if (!MANAGEABLE_ROLES.includes(role)) return res.status(400).json({ error: 'Role tidak diizinkan' });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ error: 'Email sudah terdaftar' });

    // Hanya SUPERADMIN/ADMIN yang boleh menjadikan akun sebagai PIC KOMPER.
    const canSetPic = ['SUPERADMIN', 'ADMIN'].includes(req.user.role);
    const isKomperPic = canSetPic && role === 'KOMPER' && (req.body.isKomperPic === true || req.body.isKomperPic === 'true');

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, phone, password: hashedPassword, role, isKomperPic },
      select: publicSelect,
    });

    res.status(201).json(user);
  } catch (error) {
    res.status(500).json({ error: 'Gagal membuat pengguna', detail: error.message });
  }
};

const updateUser = async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID tidak valid' });

    const existing = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
    if (!existing) return res.status(404).json({ error: 'Pengguna tidak ditemukan' });
    // Hanya boleh mengubah akun yang role-nya termasuk yang dikelola panel ini.
    if (!MANAGEABLE_ROLES.includes(existing.role)) {
      return res.status(403).json({ error: 'Akun ini tidak dapat dikelola dari panel ini' });
    }

    const data = {};
    if (req.body.isActive !== undefined) {
      const active = req.body.isActive === true || req.body.isActive === 'true';
      if (!active && existing.id === req.user.id) {
        return res.status(400).json({ error: 'Tidak dapat menonaktifkan akun sendiri' });
      }
      data.isActive = active;
    }
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: 'Nama tidak boleh kosong' });
      data.name = name;
    }
    if (req.body.phone !== undefined) {
      data.phone = req.body.phone ? String(req.body.phone).trim() : null;
    }
    if (req.body.role !== undefined) {
      const role = String(req.body.role).trim();
      if (!MANAGEABLE_ROLES.includes(role)) return res.status(400).json({ error: 'Role tidak diizinkan' });
      data.role = role;
    }
    // Hanya SUPERADMIN/ADMIN yang boleh mengubah status PIC.
    if (req.body.isKomperPic !== undefined && ['SUPERADMIN', 'ADMIN'].includes(req.user.role)) {
      data.isKomperPic = req.body.isKomperPic === true || req.body.isKomperPic === 'true';
    }
    if (req.body.password) {
      const password = String(req.body.password);
      if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });
      data.password = await bcrypt.hash(password, 10);
    }

    const user = await prisma.user.update({ where: { id }, data, select: publicSelect });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Gagal memperbarui pengguna', detail: error.message });
  }
};

const deleteUser = async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID tidak valid' });

    const existing = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
    if (!existing) return res.status(404).json({ error: 'Pengguna tidak ditemukan' });
    if (!MANAGEABLE_ROLES.includes(existing.role)) {
      return res.status(403).json({ error: 'Akun ini tidak dapat dihapus dari panel ini' });
    }
    if (existing.id === req.user.id) {
      return res.status(400).json({ error: 'Tidak dapat menghapus akun sendiri' });
    }

    await prisma.user.delete({ where: { id } });
    res.json({ message: 'Pengguna berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menghapus pengguna', detail: error.message });
  }
};

module.exports = { getRoles, listUsers, createUser, updateUser, deleteUser };
