const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DEFAULT_CATEGORIES = [
  { kode: 'KEJURDA', nama: 'Kejurda', warna: 'green', grup: 'kompetisi', urutan: 1 },
  { kode: 'KEJURCAB', nama: 'Kejurcab', warna: 'blue', grup: 'kompetisi', urutan: 2 },
  { kode: 'LATGAB', nama: 'Latihan Gabungan', warna: 'purple', grup: 'kegiatan', urutan: 1 },
  { kode: 'TOT', nama: 'TOT', warna: 'teal', grup: 'kegiatan', urutan: 2 },
  { kode: 'WORKSHOP', nama: 'Workshop', warna: 'indigo', grup: 'kegiatan', urutan: 3 },
  { kode: 'EVENT_REGULER', nama: 'Event Lainnya', warna: 'amber', grup: 'kegiatan', urutan: 4 },
];

async function main() {
  console.log('🏷️  Seeding kategori event...\n');

  for (const cat of DEFAULT_CATEGORIES) {
    const existing = await prisma.kategoriEvent.findUnique({ where: { kode: cat.kode } });
    if (existing) {
      console.log(`   ⏭️  "${cat.kode}" sudah ada, skip.`);
    } else {
      await prisma.kategoriEvent.create({ data: cat });
      console.log(`   ✅ "${cat.kode}" — ${cat.nama} (${cat.grup})`);
    }
  }

  console.log('\n✅ Seeding kategori selesai!');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
