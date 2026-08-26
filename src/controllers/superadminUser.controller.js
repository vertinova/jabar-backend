const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { isForbasiConfigured, resetForbasiPassword } = require('../lib/forbasi');
const { isSuperRole } = require('../lib/roles');

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

    // Hanya SUPERADMIN/DEVELOPER/ADMIN yang boleh menjadikan akun sebagai PIC KOMPER.
    const canSetPic = isSuperRole(req.user.role) || req.user.role === 'ADMIN';
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
    // Hanya SUPERADMIN/DEVELOPER/ADMIN yang boleh mengubah status PIC.
    if (req.body.isKomperPic !== undefined && (isSuperRole(req.user.role) || req.user.role === 'ADMIN')) {
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

// ==================== SEMUA PENGGUNA (SUPERADMIN/ADMIN) ====================
// Panel read-only untuk melihat seluruh akun di aplikasi + reset password.
// Berbeda dengan endpoint di atas yang hanya mengelola role di MANAGEABLE_ROLES.

const ALL_ROLES = ['ADMIN', 'PENGCAB', 'USER', 'PENYELENGGARA', 'UMUM', 'SUPERADMIN', 'KOMPER', 'DEVELOPER'];

const allUsersSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  phone: true,
  avatar: true,
  pengcabId: true,
  forbasiId: true,
  isKomperPic: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  pengcab: { select: { id: true, nama: true, kota: true } },
};

// GET /api/superadmin-users/all — daftar SEMUA pengguna (search + filter + paginasi).
const listAllUsers = async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const role = String(req.query.role || '').trim();
    const pengcabId = String(req.query.pengcabId || '').trim();
    const status = String(req.query.status || '').trim(); // '', 'AKTIF', 'NONAKTIF'
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const perPage = Math.min(100, Math.max(1, Number.parseInt(req.query.perPage, 10) || 20));

    const where = {};
    if (role && ALL_ROLES.includes(role)) where.role = role;
    if (pengcabId) {
      const pid = Number.parseInt(pengcabId, 10);
      if (Number.isInteger(pid)) where.pengcabId = pid;
    }
    if (status === 'AKTIF') where.isActive = true;
    if (status === 'NONAKTIF') where.isActive = false;
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
      ];
    }

    const [total, data, byRole] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: allUsersSelect,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.user.groupBy({ by: ['role'], _count: true }),
    ]);

    res.json({
      data,
      total,
      page,
      perPage,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
      roleCounts: Object.fromEntries(byRole.map((r) => [r.role, r._count])),
      totalAll: byRole.reduce((sum, r) => sum + r._count, 0),
      forbasiEnabled: isForbasiConfigured(),
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat daftar pengguna', detail: error.message });
  }
};

// POST /api/superadmin-users/all/:id/reset-password — reset password akun mana pun.
const resetUserPassword = async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID tidak valid' });

    const newPassword = String(req.body.newPassword || '');
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password baru minimal 6 karakter' });

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true, forbasiId: true },
    });
    if (!target) return res.status(404).json({ error: 'Pengguna tidak ditemukan' });

    // Hanya SUPERADMIN/DEVELOPER yang boleh mereset password akun privileged.
    if ((isSuperRole(target.role) || target.role === 'ADMIN') && !isSuperRole(req.user.role)) {
      return res.status(403).json({ error: 'Hanya Super Admin yang dapat mereset password akun ini' });
    }

    // Akun yang tertaut FORBASI Pusat bisa login lewat fallback API Pusat, jadi
    // reset lokal saja tidak efektif kecuali ikut direset di Pusat.
    const wantSync = req.body.syncForbasi === true || req.body.syncForbasi === 'true';
    let forbasiSynced = false;
    let forbasiError = null;

    if (wantSync && target.forbasiId) {
      if (!isForbasiConfigured()) {
        forbasiError = 'Integrasi FORBASI tidak aktif';
      } else {
        const result = await resetForbasiPassword(target.forbasiId, newPassword);
        if (result?.success) forbasiSynced = true;
        else forbasiError = result?.error || 'Gagal reset password di FORBASI Pusat';
      }
    }

    await prisma.user.update({
      where: { id },
      data: { password: await bcrypt.hash(newPassword, 10) },
    });

    res.json({
      message: 'Password berhasil direset',
      user: { id: target.id, name: target.name, email: target.email, role: target.role },
      forbasiLinked: !!target.forbasiId,
      forbasiSynced,
      forbasiError,
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal mereset password', detail: error.message });
  }
};

// Masa berlaku token impersonasi sengaja jauh lebih pendek dari sesi biasa:
// token ini memegang identitas orang lain, jadi kalau tab-nya ditinggal terbuka
// ia mati sendiri ketimbang menganggur seharian.
const IMPERSONATION_EXPIRES_IN = '2h';

// POST /api/superadmin-users/all/:id/impersonate - super admin membuka sesi
// sebagai pengguna lain untuk menelusuri keluhan dari sisi mereka.
//
// Token yang terbit membawa klaim `impersonatedBy` supaya jejaknya terbaca di
// sisi server; peran di dalam token adalah peran target, jadi seluruh guard yang
// sudah ada memperlakukan sesi ini persis seperti pengguna aslinya - tidak ada
// hak super yang ikut terbawa.
const impersonateUser = async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID tidak valid' });

    if (id === req.user.id) {
      return res.status(400).json({ error: 'Tidak bisa masuk sebagai akun sendiri' });
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, email: true, role: true, phone: true, avatar: true,
        pengcabId: true, forbasiId: true, isKomperPic: true, isActive: true,
        pengcab: { select: { nama: true } },
      },
    });
    if (!target) return res.status(404).json({ error: 'Pengguna tidak ditemukan' });

    // Akun privileged tidak boleh dipinjam: seorang super admin yang masuk sebagai
    // super admin lain menghapus jejak siapa sebenarnya yang bertindak.
    if (isSuperRole(target.role) || target.role === 'ADMIN') {
      return res.status(403).json({ error: 'Akun admin tidak bisa dimasuki lewat fitur ini' });
    }
    if (target.isActive === false) {
      return res.status(400).json({ error: 'Akun ini nonaktif, aktifkan dulu sebelum masuk sebagai akun ini' });
    }

    const token = jwt.sign(
      { id: target.id, email: target.email, role: target.role, impersonatedBy: req.user.id },
      process.env.JWT_SECRET,
      { expiresIn: IMPERSONATION_EXPIRES_IN }
    );

    console.log(
      `[IMPERSONASI] ${req.user.email} (id=${req.user.id}, ${req.user.role}) masuk sebagai ` +
      `${target.email} (id=${target.id}, ${target.role}) pada ${new Date().toISOString()}`
    );

    res.json({
      message: `Masuk sebagai ${target.name}`,
      token,
      expiresIn: IMPERSONATION_EXPIRES_IN,
      user: {
        id: target.id,
        name: target.name,
        email: target.email,
        role: target.role,
        phone: target.phone,
        avatar: target.avatar || null,
        pengcabId: target.pengcabId,
        pengcab: target.pengcab?.nama || null,
        isKomperPic: target.isKomperPic || false,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal masuk sebagai pengguna', detail: error.message });
  }
};

module.exports = { getRoles, listUsers, createUser, updateUser, deleteUser, listAllUsers, resetUserPassword, impersonateUser };
