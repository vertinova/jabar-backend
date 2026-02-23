const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // Show all data counts and samples
  console.log('=== CURRENT DATA ===\n');

  const users = await prisma.user.findMany({ select: { id:true, name:true, email:true, role:true } });
  console.log(`Users (${users.length}):`);
  users.forEach(u => console.log(`  #${u.id} ${u.name} (${u.email}) - ${u.role}`));

  const kejurda = await prisma.kejurda.findMany({ select: { id:true, nama:true, status:true, tanggalMulai:true } });
  console.log(`\nKejurda (${kejurda.length}):`);
  kejurda.forEach(k => console.log(`  #${k.id} ${k.nama} - ${k.status} (${k.tanggalMulai})`));

  const siteConfig = await prisma.siteConfig.findMany();
  console.log(`\nSiteConfig (${siteConfig.length}):`);
  siteConfig.forEach(s => console.log(`  ${s.key} = ${s.value ? s.value.substring(0, 80) : 'null'}`));

  const pendaftaran = await prisma.pendaftaranKejurda.count();
  const rekomendasi = await prisma.rekomendasiEvent.count();
  const kategori = await prisma.kategoriEvent.count();
  const persyaratan = await prisma.persyaratanField.count();
  console.log(`\nPendaftaran: ${pendaftaran}`);
  console.log(`Rekomendasi: ${rekomendasi}`);
  console.log(`Kategori Event: ${kategori}`);
  console.log(`Persyaratan Fields: ${persyaratan}`);

  if (kategori > 0) {
    const kats = await prisma.kategoriEvent.findMany();
    console.log('\nKategori Event:');
    kats.forEach(k => console.log(`  #${k.id} ${k.nama}`));
  }

  await prisma.$disconnect();
})();
