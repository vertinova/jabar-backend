/**
 * Tetapkan akun KOMPER sebagai PIC (penanggung jawab) role KOMPER.
 * PIC boleh membuat & mengelola akun KOMPER lain dari panel /komper/akun.
 *
 * Jalankan: npm run db:seed:komper-pic
 *
 * Override lewat env:
 *   KOMPER_PIC_EMAIL    (default: komisi@forbasi.id)
 *   KOMPER_PIC_PASSWORD (hanya dipakai bila akun belum ada; default: Komper@Jabar2026)
 *   KOMPER_PIC_NAME     (default: Komisi Perlombaan Jabar)
 */
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

const EMAIL = (process.env.KOMPER_PIC_EMAIL || 'komisi@forbasi.id').trim().toLowerCase();
const PASSWORD = process.env.KOMPER_PIC_PASSWORD || 'Komper@Jabar2026';
const NAME = process.env.KOMPER_PIC_NAME || 'Komisi Perlombaan Jabar';

async function main() {
  console.log('🌱 Menetapkan PIC KOMPER...\n');

  const existing = await prisma.user.findUnique({ where: { email: EMAIL } });

  let user;
  if (existing) {
    // Jangan ganti password akun yang sudah ada — hanya pastikan role & flag PIC.
    user = await prisma.user.update({
      where: { id: existing.id },
      data: { role: 'KOMPER', isKomperPic: true },
    });
    console.log('♻️  Akun sudah ada — ditetapkan sebagai PIC KOMPER (password tidak diubah).');
  } else {
    const hashedPassword = await bcrypt.hash(PASSWORD, 10);
    user = await prisma.user.create({
      data: { name: NAME, email: EMAIL, password: hashedPassword, role: 'KOMPER', isKomperPic: true },
    });
    console.log('✅ Akun PIC KOMPER baru dibuat.');
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  PIC KOMISI PERLOMBAAN (KOMPER)                           ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`   Email      : ${user.email}`);
  console.log(`   Role       : ${user.role}`);
  console.log(`   PIC KOMPER : ${user.isKomperPic}`);
  if (!existing) console.log(`   Password   : ${process.env.KOMPER_PIC_PASSWORD ? '(dari KOMPER_PIC_PASSWORD)' : PASSWORD}`);
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('\n🔗 Kelola akun KOMPER di: /komper/akun');
}

main()
  .catch((e) => { console.error('❌ Seed PIC KOMPER error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
