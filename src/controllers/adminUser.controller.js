const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const { fetchForbasiAccounts, fetchForbasiAccount, changeForbasiPassword, FORBASI_API_URL, FORBASI_API_KEY } = require('../lib/forbasi');

// ── Cache for anggota KTA data ──
let anggotaKtaCache = { 
  data: null, 
  lastTotal: 0, 
  lastFetch: 0,
  CACHE_TTL: 5 * 60 * 1000 // 5 minutes
};

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

// Helper: fetch and cache all anggota KTA data
const ensureAnggotaKtaCache = async (forceRefresh = false) => {
  const now = Date.now();
  const cacheValid = anggotaKtaCache.data && (now - anggotaKtaCache.lastFetch) < anggotaKtaCache.CACHE_TTL;
  
  if (!forceRefresh && cacheValid) {
    return anggotaKtaCache.data;
  }
  
  console.log('Fetching anggota KTA data from FORBASI API...');
  const startTime = Date.now();
  
  // Fetch all USER accounts from FORBASI API
  const accounts = await fetchForbasiAccounts({ role: 'user', per_page: 200 });
  
  // Check if total changed (new member)
  if (!forceRefresh && anggotaKtaCache.data && accounts.length === anggotaKtaCache.lastTotal) {
    // Just refresh timestamp, use existing data
    anggotaKtaCache.lastFetch = now;
    return anggotaKtaCache.data;
  }
  
  // Enrich with KTA data
  const BATCH_SIZE = 30; // Increased batch size for faster processing
  const allMembers = [];
  const targetYear = new Date().getFullYear().toString();

  for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
    const batch = accounts.slice(i, i + BATCH_SIZE);
    const details = await Promise.allSettled(
      batch.map(a => fetchForbasiAccount(a.username))
    );

    details.forEach((result, idx) => {
      const account = batch[idx];
      if (result.status === 'fulfilled' && result.value) {
        const detail = result.value;
        const ktaList = detail.kta || [];
        
        // Debug: log first KTA structure
        if (ktaList.length > 0 && idx === 0) {
          console.log('Sample KTA structure:', JSON.stringify(ktaList[0], null, 2));
        }
        
        // Find best KTA (prefer current year KTA Terbit, then latest)
        let activeKta = null;
        let latestKta = null;
        
        for (const k of ktaList) {
          if (!k || k.province !== 'Jawa Barat') continue;
          
          // Track active KTA (current year)
          if (k.status_label === 'KTA Terbit') {
            const issuedYear = k.kta_issued_at ? k.kta_issued_at.substring(0, 4) : null;
            if (issuedYear === targetYear) {
              activeKta = k;
            }
          }
          
          // Track latest KTA
          if (!latestKta || (k.kta_issued_at && k.kta_issued_at > (latestKta.kta_issued_at || ''))) {
            latestKta = k;
          }
        }
        
        const validKta = activeKta || latestKta;
        
        allMembers.push({
          id: account.id,
          username: account.username,
          club_name: account.club_name || detail.club_name || '-',
          city_name: account.city_name || detail.city_name || '-',
          email: account.email || detail.email || '-',
          phone: account.phone || detail.phone || '-',
          school_name: validKta?.school_name || detail.school_name || '-',
          coach_name: validKta?.coach_name || '-',
          leader_name: validKta?.leader_name || '-',
          club_address: validKta?.club_address || detail.address || '-',
          kta_status: validKta?.status_label || '-',
          kta_number: validKta?.kta_id || '-',
          kta_issued_at: validKta?.kta_issued_at || '-',
          total_kta: ktaList.length,
          is_active: !!activeKta,
        });
      }
    });
  }
  
  // Update cache
  anggotaKtaCache = {
    data: allMembers,
    lastTotal: accounts.length,
    lastFetch: Date.now(),
    CACHE_TTL: 5 * 60 * 1000
  };
  
  console.log(`Anggota KTA cache refreshed: ${allMembers.length} members in ${Date.now() - startTime}ms`);
  return allMembers;
};

// GET /api/admin-users/anggota-kta — fetch all anggota with KTA data (for admin export)
const getAnggotaKta = async (req, res) => {
  try {
    const { search, ktaStatus, refresh } = req.query;
    const targetYear = new Date().getFullYear().toString();

    // Get cached data (or fetch if needed)
    const allMembers = await ensureAnggotaKtaCache(refresh === 'true');
    
    // Apply filters
    let result = allMembers;
    
    // Filter by KTA status
    if (ktaStatus === 'AKTIF') {
      result = result.filter(m => m.is_active);
    }

    // Apply search filter
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(m =>
        m.club_name.toLowerCase().includes(q) ||
        m.city_name.toLowerCase().includes(q) ||
        m.school_name.toLowerCase().includes(q) ||
        m.coach_name.toLowerCase().includes(q) ||
        m.username.toLowerCase().includes(q)
      );
    }

    res.json({ 
      success: true, 
      total: result.length, 
      year: targetYear, 
      cached: !req.query.refresh,
      cacheAge: anggotaKtaCache.lastFetch ? Math.round((Date.now() - anggotaKtaCache.lastFetch) / 1000) : 0,
      data: result 
    });
  } catch (error) {
    console.error('Fetch anggota KTA error:', error);
    res.status(500).json({ error: 'Gagal mengambil data anggota KTA', detail: error.message });
  }
};

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

module.exports = { getAllUsers, getUserById, updateUser, getForbasiAccounts, getForbasiAccountDetail, resetForbasiPassword, getUserStats, getAnggotaKta };
