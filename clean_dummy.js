const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  console.log('=== CLEANING DUMMY DATA ===\n');

  // 1. Delete pendaftaran (depends on kejurda)
  const delPendaftaran = await prisma.pendaftaranKejurda.deleteMany();
  console.log(`Deleted pendaftaran: ${delPendaftaran.count}`);

  // 2. Delete rekomendasi
  const delRekomendasi = await prisma.rekomendasiEvent.deleteMany();
  console.log(`Deleted rekomendasi: ${delRekomendasi.count}`);

  // 3. Delete persyaratan fields (depends on kejurda)
  const delPersyaratan = await prisma.persyaratanField.deleteMany();
  console.log(`Deleted persyaratan: ${delPersyaratan.count}`);

  // 4. Delete all kejurda (dummy/seed data)
  const delKejurda = await prisma.kejurda.deleteMany();
  console.log(`Deleted kejurda: ${delKejurda.count}`);

  // 5. Delete hero slides (empty anyway)
  const delHero = await prisma.heroSlide.deleteMany();
  console.log(`Deleted hero_slides: ${delHero.count}`);

  // 6. Delete berita (empty anyway)
  const delBerita = await prisma.berita.deleteMany();
  console.log(`Deleted berita: ${delBerita.count}`);

  // 7. Delete feedback (empty anyway)
  const delFeedback = await prisma.feedback.deleteMany();
  console.log(`Deleted feedback: ${delFeedback.count}`);

  // 8. Delete struktur organisasi (empty anyway)
  const delStruktur = await prisma.strukturOrganisasi.deleteMany();
  console.log(`Deleted struktur: ${delStruktur.count}`);

  // KEEP: users (admin real), pengcab (real from API), site_config (needed), kategori_event
  console.log('\n=== KEPT ===');
  const users = await prisma.user.count();
  const pengcab = await prisma.pengcab.count();
  const siteConfig = await prisma.siteConfig.count();
  const kategori = await prisma.kategoriEvent.count();
  console.log(`  Users: ${users} (admin real)`);
  console.log(`  Pengcab: ${pengcab} (real dari API)`);
  console.log(`  SiteConfig: ${siteConfig} (config landing page)`);
  console.log(`  KategoriEvent: ${kategori}`);

  console.log('\n=== CLEANUP DONE ===');
  await prisma.$disconnect();
})();
