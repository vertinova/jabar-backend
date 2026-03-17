const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { verifyForbasiLogin, fetchForbasiKta, fixForbasiFileUrl, changeForbasiPassword } = require('../lib/forbasi');

// In-memory SSO token store (short-lived, single-use)
const ssoTokens = new Map();
const SSO_TOKEN_TTL = 60_000; // 60 seconds

/**
 * Handle FORBASI user login — find/create local account from FORBASI data.
 * Shared by both email-fallback and username login paths.
 */
async function handleForbasiUserLogin(identifier, forbasiUser, password) {
  // ── Check if this is a Pengda admin account (super admin) ──
  if (identifier.startsWith('admin_pengda_')) {
    const forbasiEmail = forbasiUser.email || `${identifier}@forbasi.local`;
    let user = await prisma.user.findFirst({
      where: { OR: [{ email: forbasiEmail }, { email: `${identifier}@forbasi.local` }] }
    });
    if (!user) {
      const hashedPassword = await bcrypt.hash(password, 10);
      user = await prisma.user.create({
        data: {
          name: forbasiUser.club_name || forbasiUser.name || 'Admin Pengda',
          email: forbasiEmail,
          password: hashedPassword,
          phone: forbasiUser.phone || null,
          forbasiId: forbasiUser.id || null,
          role: 'ADMIN'
        }
      });
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const updateData = { password: hashedPassword, role: 'ADMIN' };
      if (forbasiUser.club_name) updateData.name = forbasiUser.club_name;
      if (forbasiUser.phone) updateData.phone = forbasiUser.phone;
      if (forbasiUser.id && !user.forbasiId) updateData.forbasiId = forbasiUser.id;
      user = await prisma.user.update({ where: { id: user.id }, data: updateData });
    }
    return user;
  }

  // Check if this username belongs to a pengcab
  const pengcab = await prisma.pengcab.findUnique({ where: { username: identifier } });

  if (pengcab) {
    // ── PENGCAB login flow ──
    // Name for pengcab accounts = club_name from FORBASI API (no personal name field exists)
    const pengcabName = forbasiUser.club_name || pengcab.nama;
    const pengcabEmail = forbasiUser.email || pengcab.email || `${identifier}@forbasi.local`;
    const pengcabPhone = forbasiUser.phone || pengcab.phone || null;
    const hashedPassword = await bcrypt.hash(password, 10);

    // Sync pengcab record from FORBASI API
    await prisma.pengcab.update({
      where: { id: pengcab.id },
      data: {
        nama: pengcabName,
        email: forbasiUser.email || pengcab.email,
        phone: forbasiUser.phone || pengcab.phone,
        alamat: forbasiUser.address || pengcab.alamat,
        logo: fixForbasiFileUrl(forbasiUser.logo_url) || pengcab.logo,
        forbasiId: forbasiUser.id || pengcab.forbasiId,
      }
    });

    let user = await prisma.user.findFirst({ where: { pengcabId: pengcab.id } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          name: pengcabName,
          email: pengcabEmail,
          password: hashedPassword,
          phone: pengcabPhone,
          pengcabId: pengcab.id,
          forbasiId: forbasiUser.id || null,
          role: 'PENGCAB'
        }
      });
    } else {
      // Always sync data from FORBASI API on every login
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          name: pengcabName,
          email: pengcabEmail,
          password: hashedPassword,
          phone: pengcabPhone,
          forbasiId: forbasiUser.id || null,
          role: 'PENGCAB'
        }
      });
    }
    return user;
  }

  // ── Regular FORBASI user login flow ──
  // Auto-find pengcab based on city_name from FORBASI
  let matchedPengcabId = null;
  if (forbasiUser.city_name) {
    const matchedPengcab = await prisma.pengcab.findFirst({
      where: { kota: { contains: forbasiUser.city_name } }
    });
    if (matchedPengcab) matchedPengcabId = matchedPengcab.id;
  }

  // Find existing local account linked to this FORBASI user
  const forbasiEmail = forbasiUser.email || `${identifier}@user.forbasi.local`;
  let user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: forbasiEmail },
        { email: `${identifier}@user.forbasi.local` }
      ]
    }
  });

  if (!user) {
    // Auto-create local USER account with pengcab linked
    const hashedPassword = await bcrypt.hash(password, 10);
    user = await prisma.user.create({
      data: {
        name: forbasiUser.name || forbasiUser.club_name || forbasiUser.username || identifier,
        email: forbasiEmail,
        password: hashedPassword,
        phone: forbasiUser.phone || null,
        avatar: fixForbasiFileUrl(forbasiUser.logo_url) || null,
        pengcabId: matchedPengcabId,
        forbasiId: forbasiUser.id || null,
        role: 'USER'
      }
    });
  } else {
    // Always sync data from FORBASI API on every login
    const hashedPassword = await bcrypt.hash(password, 10);
    const updateData = { password: hashedPassword };
    if (matchedPengcabId) updateData.pengcabId = matchedPengcabId;
    const userName = forbasiUser.name || forbasiUser.club_name || forbasiUser.username;
    if (userName) updateData.name = userName;
    if (forbasiUser.email) updateData.email = forbasiUser.email;
    if (forbasiUser.phone) updateData.phone = forbasiUser.phone;
    if (forbasiUser.logo_url) updateData.avatar = fixForbasiFileUrl(forbasiUser.logo_url);
    if (forbasiUser.id) updateData.forbasiId = forbasiUser.id;
    user = await prisma.user.update({
      where: { id: user.id },
      data: updateData
    });
  }
  return user;
}

const register = async (req, res) => {
  try {
    const { name, email, password, phone, pengcabId, role } = req.body;

    // Validate role - only allow PENYELENGGARA or UMUM for public registration
    const validRoles = ['PENYELENGGARA', 'UMUM'];
    const userRole = validRoles.includes(role) ? role : 'UMUM';

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: 'Email sudah terdaftar' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, password: hashedPassword, phone, pengcabId: pengcabId ? parseInt(pengcabId) : null, role: userRole },
      select: { id: true, name: true, email: true, role: true, phone: true, pengcabId: true, createdAt: true }
    });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.status(201).json({ message: 'Registrasi berhasil', user, token });
  } catch (error) {
    res.status(500).json({ error: 'Gagal registrasi', detail: error.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Support login by email OR username (FORBASI pengcab username)
    let user = null;
    const isEmail = email && email.includes('@');

    if (isEmail) {
      // Login with email — first try local database
      user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
          // Local password failed — try FORBASI API as fallback
          // (password might have changed on FORBASI side)
          const forbasiResult = await verifyForbasiLogin(email, password);
          if (forbasiResult.success && forbasiResult.user) {
            // FORBASI login succeeded, update local account
            user = await handleForbasiUserLogin(email, forbasiResult.user, password);
          } else {
            return res.status(401).json({ error: 'Username/email atau password salah' });
          }
        }
      } else {
        // Not found locally — some FORBASI accounts use email as username,
        // so try FORBASI API as fallback
        const forbasiResult = await verifyForbasiLogin(email, password);
        if (!forbasiResult.success || !forbasiResult.user) {
          return res.status(401).json({ error: forbasiResult.error || 'Username/email atau password salah' });
        }
        // Proceed with FORBASI user flow (same as username login below)
        user = await handleForbasiUserLogin(email, forbasiResult.user, password);
      }
    } else if (email) {
      // Login with FORBASI username — verify password via FORBASI API
      const forbasiResult = await verifyForbasiLogin(email, password);
      if (!forbasiResult.success || !forbasiResult.user) {
        return res.status(401).json({ error: forbasiResult.error || 'Username atau password FORBASI salah' });
      }
      user = await handleForbasiUserLogin(email, forbasiResult.user, password);
    } else {
      return res.status(401).json({ error: 'Username/email atau password salah' });
    }

    // Fetch pengcab name for response
    let pengcabName = null;
    if (user.pengcabId) {
      const pc = await prisma.pengcab.findUnique({ where: { id: user.pengcabId }, select: { nama: true, kota: true } });
      if (pc) pengcabName = pc.nama;
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({
      message: 'Login berhasil',
      user: { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone, avatar: user.avatar || null, pengcabId: user.pengcabId, pengcab: pengcabName },
      token
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal login', detail: error.message });
  }
};

const getProfile = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, name: true, email: true, role: true, phone: true,
        avatar: true, pengcabId: true, createdAt: true,
        pengcab: { select: { id: true, nama: true, kota: true } }
      }
    });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil profil', detail: error.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const { name, phone, pengcabId, currentPassword, newPassword } = req.body;
    const updateData = {};

    if (name) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (pengcabId !== undefined) updateData.pengcabId = pengcabId ? parseInt(pengcabId) : null;

    // Handle password change
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Password lama harus diisi untuk mengubah password' });
      }
      const existingUser = await prisma.user.findUnique({ where: { id: req.user.id } });
      const validPassword = await bcrypt.compare(currentPassword, existingUser.password);
      if (!validPassword) {
        // If local password check fails, try verifying against FORBASI API
        if (existingUser.forbasiId) {
          const forbasiCheck = await verifyForbasiLogin(existingUser.email, currentPassword);
          if (!forbasiCheck) {
            return res.status(400).json({ error: 'Password lama tidak sesuai' });
          }
        } else {
          return res.status(400).json({ error: 'Password lama tidak sesuai' });
        }
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'Password baru minimal 6 karakter' });
      }

      // If FORBASI-linked account, also update on FORBASI API
      if (existingUser.forbasiId) {
        try {
          const forbasiResult = await changeForbasiPassword(existingUser.forbasiId, currentPassword, newPassword);
          if (!forbasiResult || !forbasiResult.success) {
            console.warn('FORBASI password sync warning:', forbasiResult?.message || 'Unknown error');
            // Continue anyway - update local password even if FORBASI sync fails
          }
        } catch (err) {
          console.warn('FORBASI password sync error:', err.message);
        }
      }

      updateData.password = await bcrypt.hash(newPassword, 10);
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: updateData,
      select: {
        id: true, name: true, email: true, role: true, phone: true,
        pengcabId: true, createdAt: true,
        pengcab: { select: { id: true, nama: true, kota: true } }
      }
    });
    res.json({ message: 'Profil berhasil diupdate', user });
  } catch (error) {
    res.status(500).json({ error: 'Gagal update profil', detail: error.message });
  }
};

const getUserDashboard = async (req, res) => {
  try {
    const userId = req.user.id;
    const userProfile = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, email: true, phone: true, pengcabId: true, role: true,
        pengcab: { select: { id: true, nama: true, kota: true } }
      }
    });

    if (req.user.role === 'PENYELENGGARA') {
      // Penyelenggara: rekomendasi event data
      const [totalRekomendasi, rekomendasiByStatus, recentRekomendasi] = await Promise.all([
        prisma.rekomendasiEvent.count({ where: { userId } }),
        prisma.rekomendasiEvent.groupBy({
          by: ['status'], where: { userId }, _count: true
        }),
        prisma.rekomendasiEvent.findMany({
          where: { userId }, orderBy: { createdAt: 'desc' }, take: 5,
          include: { pengcab: { select: { nama: true, kota: true } } }
        }),
      ]);
      return res.json({ totalRekomendasi, rekomendasiByStatus, recentRekomendasi, userProfile });
    }

    // USER (Anggota FORBASI): kejurda event data
    const [openKejurda, totalPendaftaran, pendaftaranByStatus, recentPendaftaran] = await Promise.all([
      prisma.kejurda.findMany({
        where: { statusBuka: true },
        orderBy: { tanggalMulai: 'asc' },
        take: 5
      }),
      prisma.pendaftaranKejurda.count({ where: { userId } }),
      prisma.pendaftaranKejurda.groupBy({
        by: ['status'], where: { userId }, _count: true
      }),
      prisma.pendaftaranKejurda.findMany({
        where: { userId }, orderBy: { createdAt: 'desc' }, take: 5,
        include: { kejurda: { select: { namaKejurda: true, tanggalMulai: true, lokasi: true } } }
      }),
    ]);
    res.json({ openKejurda, totalPendaftaran, pendaftaranByStatus, recentPendaftaran, userProfile });
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil dashboard', detail: error.message });
  }
};

const getKta = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { forbasiId: true, email: true }
    });

    if (!user || !user.forbasiId) {
      return res.json({ total_kta: 0, kta: [], message: 'Akun tidak terhubung dengan FORBASI' });
    }

    const ktaData = await fetchForbasiKta(user.forbasiId);
    res.json(ktaData);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data KTA', detail: error.message });
  }
};

/**
 * Generate a short-lived, single-use SSO token for cross-domain auth.
 * Authenticated user gets a token they can pass to forbasi.or.id to auto-login.
 */
const generateSsoToken = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, email: true, role: true, forbasiId: true }
    });
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

    const token = crypto.randomBytes(32).toString('hex');
    ssoTokens.set(token, {
      userId: user.id,
      email: user.email,
      role: user.role,
      forbasiId: user.forbasiId,
      name: user.name,
      expiresAt: Date.now() + SSO_TOKEN_TTL,
    });

    // Auto-cleanup expired token
    setTimeout(() => ssoTokens.delete(token), SSO_TOKEN_TTL);

    res.json({ token, expiresIn: SSO_TOKEN_TTL / 1000 });
  } catch (error) {
    res.status(500).json({ error: 'Gagal generate SSO token', detail: error.message });
  }
};

/**
 * Validate and consume an SSO token (called by forbasi.or.id).
 * Returns user info if token is valid, then deletes it (single-use).
 */
const validateSsoToken = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token wajib diisi' });

    const data = ssoTokens.get(token);
    if (!data) return res.status(401).json({ error: 'Token tidak valid atau sudah digunakan' });
    if (Date.now() > data.expiresAt) {
      ssoTokens.delete(token);
      return res.status(401).json({ error: 'Token sudah kedaluwarsa' });
    }

    // Single-use: delete after validation
    ssoTokens.delete(token);

    res.json({
      valid: true,
      user: {
        userId: data.userId,
        email: data.email,
        role: data.role,
        forbasiId: data.forbasiId,
        name: data.name,
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal validasi SSO token', detail: error.message });
  }
};

module.exports = { register, login, getProfile, updateProfile, getUserDashboard, getKta, generateSsoToken, validateSsoToken };
