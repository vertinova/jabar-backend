/**
 * Seed akun DEVELOPER (role DEVELOPER) untuk Pengda Jabar.
 *
 * Hak aksesnya identik SUPERADMIN — kelola seluruh event vote (konfigurasi,
 * kategori/nominee, statistik, pencairan, riwayat transaksi semua penyelenggara),
 * monitoring, dan kelola akun — ditambah panel REKAP BIAYA ADMIN (/admin/biaya-admin)
 * untuk memantau biaya admin yang terkumpul dari setiap transaksi vote.
 *
 * Akun LOKAL: login memakai `username` + password, tidak lewat FORBASI Pusat.
 *
 * Jalankan: npm run db:seed:developer
 *
 * Kredensial dapat di-override lewat environment variable:
 *   DEVELOPER_USERNAME, DEVELOPER_PASSWORD, DEVELOPER_NAME, DEVELOPER_EMAIL
 */
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

const USERNAME = (process.env.DEVELOPER_USERNAME || 'hawsyi').trim().toLowerCase();
const PASSWORD = process.env.DEVELOPER_PASSWORD || 'nobunaga1945';
const NAME = process.env.DEVELOPER_NAME || 'Developer';
const EMAIL = (process.env.DEVELOPER_EMAIL || `${USERNAME}@developer.forbasi.local`).trim().toLowerCase();

async function main() {
  console.log('🌱 Seeding akun developer...\n');

  const hashedPassword = await bcrypt.hash(PASSWORD, 10);

  // Akun bisa sudah ada dengan username ATAU email yang sama (mis. dibuat manual).
  const existing =
    (await prisma.user.findUnique({ where: { username: USERNAME } })) ||
    (await prisma.user.findUnique({ where: { email: EMAIL } }));

  let user;
  if (existing) {
    user = await prisma.user.update({
      where: { id: existing.id },
      data: { name: NAME, username: USERNAME, email: EMAIL, password: hashedPassword, role: 'DEVELOPER', isActive: true },
    });
    console.log('♻️  Akun sudah ada — diperbarui menjadi DEVELOPER.');
  } else {
    user = await prisma.user.create({
      data: { name: NAME, username: USERNAME, email: EMAIL, password: hashedPassword, role: 'DEVELOPER' },
    });
    console.log('✅ Akun developer baru berhasil dibuat.');
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  KREDENSIAL LOGIN DEVELOPER                               ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`   Username : ${user.username}`);
  console.log(`   Password : ${process.env.DEVELOPER_PASSWORD ? '(dari DEVELOPER_PASSWORD)' : PASSWORD}`);
  console.log(`   Email    : ${user.email}`);
  console.log(`   Role     : ${user.role}`);
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('\n🔗 Kelola vote  : /admin/vote');
  console.log('🔗 Biaya admin  : /admin/biaya-admin');
}

main()
  .catch((e) => { console.error('❌ Seed developer error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
