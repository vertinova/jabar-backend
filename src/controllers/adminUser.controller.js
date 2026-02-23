const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { fetchForbasiAccounts, fetchForbasiAccount, changeForbasiPassword, FORBASI_API_URL, FORBASI_API_KEY } = require('../lib/forbasi');

// GET /api/admin-users — list all users (pengda level, all regions)
const getAllUsers = async (req, res) => {
  try {
    const { pengcabId, role, search } = req.query;

    const where = {};
    if (pengcabId) where.pengcabId = parseInt(pengcabId);
    if (role) where.role = role;
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        pengcabId: true,
        forbasiId: true,
        createdAt: true,
        pengcab: { select: { id: true, nama: true, kota: true } },
      }
    });

    res.json(users);
  } catch (error) {
    console.error('Admin get users error:', error);
    res.status(500).json({ error: 'Gagal memuat data users', detail: error.message });
  }
};

// GET /api/admin-users/:id — get single user detail
const getUserById = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: parseInt(req.params.id) },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        pengcabId: true,
        createdAt: true,
        pengcab: { select: { id: true, nama: true, kota: true } },
      }
    });
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat data user', detail: error.message });
  }
};

// PUT /api/admin-users/:id — admin edit any user profile + password
const updateUser = async (req, res) => {
  try {
    const { name, phone, role, pengcabId, newPassword } = req.body;
    const userId = parseInt(req.params.id);

    const existingUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!existingUser) return res.status(404).json({ error: 'User tidak ditemukan' });

    const updateData = {};
    if (name) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (role) updateData.role = role;
    if (pengcabId !== undefined) updateData.pengcabId = pengcabId ? parseInt(pengcabId) : null;
    if (newPassword) {
      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'Password baru minimal 6 karakter' });
      }
      updateData.password = await bcrypt.hash(newPassword, 10);
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        pengcabId: true,
        createdAt: true,
        pengcab: { select: { id: true, nama: true, kota: true } },
      }
    });

    res.json({ message: 'Data user berhasil diupdate', user });
  } catch (error) {
    console.error('Admin update user error:', error);
    res.status(500).json({ error: 'Gagal update user', detail: error.message });
  }
};

// GET /api/admin-users/forbasi-accounts — fetch all FORBASI members
const getForbasiAccounts = async (req, res) => {
  try {
    const { role, search, page, per_page } = req.query;
    const options = {};
    if (role) options.role = role;
    if (search) options.search = search;
    if (page) options.page = page;
    options.per_page = per_page || 200;

    const data = await fetchForbasiAccounts(options);
    res.json({ success: true, total: data.length, data });
  } catch (error) {
    console.error('Fetch FORBASI accounts error:', error);
    res.status(500).json({ error: 'Gagal mengambil data dari FORBASI API', detail: error.message });
  }
};

// GET /api/admin-users/forbasi-accounts/:id — fetch single FORBASI account
const getForbasiAccountDetail = async (req, res) => {
  try {
    const data = await fetchForbasiAccount(parseInt(req.params.id));
    if (!data) return res.status(404).json({ error: 'Akun FORBASI tidak ditemukan' });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil detail akun FORBASI', detail: error.message });
  }
};

// POST /api/admin-users/forbasi-reset-password — reset password for FORBASI user (admin action)
const resetForbasiPassword = async (req, res) => {
  try {
    const { forbasiId, newPassword } = req.body;
    if (!forbasiId || !newPassword) {
      return res.status(400).json({ error: 'forbasiId dan newPassword diperlukan' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password baru minimal 6 karakter' });
    }

    // Use FORBASI API reset_password action (admin level API key)
    const url = `${FORBASI_API_URL}?action=reset_password`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': FORBASI_API_KEY },
      body: JSON.stringify({ id: forbasiId, new_password: newPassword })
    });
    const result = await response.json().catch(() => null);

    if (!result || !result.success) {
      return res.status(400).json({ error: result?.error || 'Gagal reset password FORBASI', detail: result });
    }

    // Also update local user password if linked
    const localUser = await prisma.user.findUnique({ where: { forbasiId: parseInt(forbasiId) } });
    if (localUser) {
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await prisma.user.update({ where: { id: localUser.id }, data: { password: hashedPassword } });
    }

    res.json({ message: 'Password berhasil direset', synced: !!localUser });
  } catch (error) {
    console.error('Reset FORBASI password error:', error);
    res.status(500).json({ error: 'Gagal reset password FORBASI', detail: error.message });
  }
};

// GET /api/admin-users/stats — summary statistics
const getUserStats = async (req, res) => {
  try {
    const [totalUsers, byRole, byPengcab] = await Promise.all([
      prisma.user.count(),
      prisma.user.groupBy({ by: ['role'], _count: true }),
      prisma.user.groupBy({ by: ['pengcabId'], _count: true, where: { pengcabId: { not: null } } }),
    ]);

    // Get pengcab names for the stats
    const pengcabIds = byPengcab.map(p => p.pengcabId).filter(Boolean);
    const pengcabs = await prisma.pengcab.findMany({
      where: { id: { in: pengcabIds } },
      select: { id: true, nama: true, kota: true }
    });
    const pengcabMap = Object.fromEntries(pengcabs.map(p => [p.id, p]));

    const roleStats = Object.fromEntries(byRole.map(r => [r.role, r._count]));
    const pengcabStats = byPengcab
      .filter(p => p.pengcabId)
      .map(p => ({
        pengcabId: p.pengcabId,
        nama: pengcabMap[p.pengcabId]?.nama || 'Unknown',
        kota: pengcabMap[p.pengcabId]?.kota || '',
        count: p._count,
      }))
      .sort((a, b) => b.count - a.count);

    res.json({ totalUsers, roleStats, pengcabStats });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat statistik', detail: error.message });
  }
};

module.exports = { getAllUsers, getUserById, updateUser, getForbasiAccounts, getForbasiAccountDetail, resetForbasiPassword, getUserStats };
