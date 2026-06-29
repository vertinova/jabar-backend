/**
 * Seed akun KOMISI PERLOMBAAN (role KOMPER) untuk Pengda Jabar.
 *
 * Akun ini khusus menginput hasil juara (ranking prestasi) dari event-event yang
 * sudah DISETUJUI dan memiliki surat rekomendasi. Hasil yang diinput langsung
 * tampil pada klasemen Ranking Prestasi di landing page.
 *
 * Akun dibuat sebagai akun LOKAL (email + password), sehingga bisa login langsung
 * tanpa harus melewati FORBASI API (mirip akun super admin).
 *
 * Jalankan: npm run db:seed:komper
 *
 * Kredensial dapat di-override lewat environment variable:
 *   KOMPER_EMAIL, KOMPER_PASSWORD, KOMPER_NAME
 */
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

const EMAIL = (process.env.KOMPER_EMAIL || 'komper@jabar.forbasi.id').trim().toLowerCase();
const PASSWORD = process.env.KOMPER_PASSWORD || 'Komper@Jabar2026';
const NAME = process.env.KOMPER_NAME || 'Komisi Perlombaan Jabar';

async function main() {
  console.log('🌱 Seeding akun komisi perlombaan...\n');

  const hashedPassword = await bcrypt.hash(PASSWORD, 10);

  const existing = await prisma.user.findUnique({ where: { email: EMAIL } });

  let user;
  if (existing) {
    user = await prisma.user.update({
      where: { id: existing.id },
      data: { name: NAME, password: hashedPassword, role: 'KOMPER' },
    });
    console.log('♻️  Akun sudah ada — diperbarui menjadi KOMISI PERLOMBAAN (role KOMPER).');
  } else {
    user = await prisma.user.create({
      data: { name: NAME, email: EMAIL, password: hashedPassword, role: 'KOMPER' },
    });
    console.log('✅ Akun komisi perlombaan baru berhasil dibuat.');
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  KREDENSIAL LOGIN KOMISI PERLOMBAAN                       ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`   Email    : ${user.email}`);
  console.log(`   Password : ${process.env.KOMPER_PASSWORD ? '(dari KOMPER_PASSWORD)' : PASSWORD}`);
  console.log(`   Role     : ${user.role}`);
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('\n⚠️  Segera ganti password default melalui menu Profil setelah login pertama.');
  console.log('🔗 Input hasil juara di: /komper');
}

main()
  .catch((e) => { console.error('❌ Seed komper error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
