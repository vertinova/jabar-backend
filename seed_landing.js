const prisma = require('./src/lib/prisma');

(async () => {
  const defaults = {
    hero_badge: 'Pengurus Daerah Jawa Barat',
    hero_title_line1: 'FORBASI',
    hero_title_line2: 'Jawa Barat',
    hero_subtitle: 'Platform digital terpadu untuk pengelolaan event, kejuaraan daerah, dan rekomendasi perizinan FORBASI Provinsi Jawa Barat',
    hero_cta_primary: 'Masuk ke Sistem',
    hero_cta_secondary: 'Lihat Event',
    section_events: true,
    section_map: true,
    section_struktur: true,
    section_berita: true,
    section_feedback: true,
    section_cta: true,
  };

  for (const [key, value] of Object.entries(defaults)) {
    await prisma.siteConfig.upsert({
      where: { key },
      create: { key, value },
      update: {},
    });
  }
  console.log('Site config seeded:', Object.keys(defaults).length, 'keys');

  // Seed a sample berita
  const beritaCount = await prisma.berita.count();
  if (beritaCount === 0) {
    await prisma.berita.createMany({
      data: [
        { judul: 'Kejuaraan Daerah Binaraga Jawa Barat 2026', ringkasan: 'Pengda FORBASI Jawa Barat akan menyelenggarakan Kejurda yang diikuti seluruh pengurus cabang se-Jawa Barat.', penulis: 'Admin', aktif: true },
        { judul: 'Pelatihan & TOT Juri FORBASI', ringkasan: 'Program pelatihan dan Training of Trainers untuk meningkatkan kualitas penjurian di tingkat daerah dan cabang.', penulis: 'Admin', aktif: true },
        { judul: 'Pendaftaran Anggota Baru FORBASI', ringkasan: 'Pendaftaran anggota baru FORBASI Jawa Barat kini dapat dilakukan secara online melalui sistem informasi terpadu.', penulis: 'Admin', aktif: true },
      ]
    });
    console.log('Sample berita seeded');
  }

  await prisma.$disconnect();
})();
