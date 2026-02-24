const prisma = require('./src/lib/prisma');

(async () => {
  const exists = await prisma.formatDokumen.findFirst({ where: { nama: 'Pakta Integritas' } });
  if (!exists) {
    const r = await prisma.formatDokumen.create({
      data: {
        nama: 'Pakta Integritas',
        deskripsi: 'Format Pakta Integritas untuk penyelenggara event',
        filePath: '/uploads/pakta-integritas-web.docx',
        kategori: 'perangkat',
        urutan: 1,
      }
    });
    console.log('Seeded:', r);
  } else {
    console.log('Already exists:', exists);
  }
  await prisma.$disconnect();
})();
