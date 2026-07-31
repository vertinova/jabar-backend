// Peran "super" yang mengelola modul e-voting lintas penyelenggara.
//
// DEVELOPER punya hak akses identik SUPERADMIN (kelola semua vote, monitoring,
// kelola akun) dan tambahan panel rekap biaya admin. Semua guard memakai helper
// di sini agar penambahan peran baru tidak perlu disebar ke banyak file.
const SUPER_ROLES = ['SUPERADMIN', 'DEVELOPER'];

// Role yang diperlakukan setara admin di modul voting/monitoring.
const ADMIN_LIKE_ROLES = ['ADMIN', ...SUPER_ROLES];

// Role yang boleh melihat/mengelola rekap biaya admin transaksi vote.
const ADMIN_FEE_ROLES = ['ADMIN', ...SUPER_ROLES];

const isSuperRole = (role) => SUPER_ROLES.includes(role);
const isAdminLikeRole = (role) => ADMIN_LIKE_ROLES.includes(role);

module.exports = { SUPER_ROLES, ADMIN_LIKE_ROLES, ADMIN_FEE_ROLES, isSuperRole, isAdminLikeRole };
