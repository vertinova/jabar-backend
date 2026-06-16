/**
 * Seed akun SUPER ADMIN (role ADMIN) untuk Pengda Jabar.
 *
 * Super admin ini dapat mengelola SEMUA event vote — termasuk konfigurasi voting,
 * kategori/nominee, statistik, pencairan, dan melihat riwayat transaksi seluruh
 * penyelenggara (endpoint /api/voting/admin/* memberi akses penuh untuk role ADMIN).
 *
 * Akun dibuat sebagai akun LOKAL (email + password), sehingga bisa login langsung
 * tanpa harus melewati FORBASI API.
 *
 * Jalankan: npm run db:seed:superadmin
 *
 * Kredensial dapat di-override lewat environment variable:
 *   SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD, SUPERADMIN_NAME
 */
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

const EMAIL = (process.env.SUPERADMIN_EMAIL || 'superadmin@jabar.forbasi.id').trim().toLowerCase();
const PASSWORD = process.env.SUPERADMIN_PASSWORD || 'SuperAdmin@Jabar2026';
const NAME = process.env.SUPERADMIN_NAME || 'Super Admin Jabar';

async function main() {
  console.log('🌱 Seeding akun super admin...\n');

  const hashedPassword = await bcrypt.hash(PASSWORD, 10);

  const existing = await prisma.user.findUnique({ where: { email: EMAIL } });

  let user;
  if (existing) {
    user = await prisma.user.update({
      where: { id: existing.id },
      data: { name: NAME, password: hashedPassword, role: 'ADMIN' },
    });
    console.log('♻️  Akun sudah ada — diperbarui menjadi SUPER ADMIN (role ADMIN).');
  } else {
    user = await prisma.user.create({
      data: { name: NAME, email: EMAIL, password: hashedPassword, role: 'ADMIN' },
    });
    console.log('✅ Akun super admin baru berhasil dibuat.');
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  KREDENSIAL LOGIN SUPER ADMIN                             ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`   Email    : ${user.email}`);
  console.log(`   Password : ${process.env.SUPERADMIN_PASSWORD ? '(dari SUPERADMIN_PASSWORD)' : PASSWORD}`);
  console.log(`   Role     : ${user.role}`);
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('\n⚠️  Segera ganti password default melalui menu Profil setelah login pertama.');
  console.log('🔗 Kelola semua vote di: /admin/vote');
}

main()
  .catch((e) => { console.error('❌ Seed super admin error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
