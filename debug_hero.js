const prisma = require('./src/lib/prisma');
const fs = require('fs');
const path = require('path');

async function check() {
  console.log('=== HERO SLIDES IN DB ===');
  const slides = await prisma.heroSlide.findMany({ orderBy: { urutan: 'asc' } });
  for (const s of slides) {
    const filePath = path.join(__dirname, s.gambar || '');
    const exists = s.gambar ? fs.existsSync(filePath) : false;
    console.log(`id=${s.id} urutan=${s.urutan} gambar=${s.gambar} exists=${exists}`);
  }

  console.log('\n=== RECENT FILES ON DISK ===');
  const uploadsDir = path.join(__dirname, 'uploads');
  const files = fs.readdirSync(uploadsDir).sort().reverse().slice(0, 10);
  files.forEach(f => {
    const stat = fs.statSync(path.join(uploadsDir, f));
    console.log(`${f} - ${Math.round(stat.size/1024)}KB - ${stat.mtime.toISOString()}`);
  });

  await prisma.$disconnect();
}

check().catch(console.error);
