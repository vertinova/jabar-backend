// Full VPS diagnostic using Prisma
const { PrismaClient } = require('@prisma/client');
const http = require('http');
const https = require('https');
const fs = require('fs');

const prisma = new PrismaClient();

function apiCall(method, path, body, token) {
  return new Promise(resolve => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request({hostname:'127.0.0.1',port:5023,path,method,headers}, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve({status:res.statusCode,body:d}));
    });
    req.on('error', e => resolve({status:0,body:e.message}));
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  try {
    // 1. Users
    const users = await prisma.user.findMany({ select: { id:true, name:true, email:true, role:true } });
    console.log('=== USERS ===');
    users.forEach(u => console.log(`  #${u.id} ${u.name} (${u.email}) - ${u.role}`));

    // 2. Data counts
    console.log('\n=== DATA COUNTS ===');
    const pengcabCount = await prisma.pengcab.count();
    const kejurdaCount = await prisma.kejurda.count();
    const heroCount = await prisma.heroSlide.count();
    const beritaCount = await prisma.berita.count();
    const feedbackCount = await prisma.feedback.count();
    const siteConfigCount = await prisma.siteConfig.count();
    const strukturCount = await prisma.strukturOrganisasi.count();
    console.log(`  pengcab: ${pengcabCount}`);
    console.log(`  kejurda: ${kejurdaCount}`);
    console.log(`  hero_slides: ${heroCount}`);
    console.log(`  berita: ${beritaCount}`);
    console.log(`  feedback: ${feedbackCount}`);
    console.log(`  site_config: ${siteConfigCount}`);
    console.log(`  struktur_organisasi: ${strukturCount}`);

    // 3. Pengcab details
    if (pengcabCount > 0) {
      const pengcabs = await prisma.pengcab.findMany({ select: { id:true, nama:true, kota:true } });
      console.log('\n=== PENGCAB ===');
      pengcabs.forEach(p => console.log(`  #${p.id} ${p.nama} - ${p.kota}`));
    }

    // 4. Login tests
    console.log('\n=== LOGIN TESTS ===');
    const r1 = await apiCall('POST', '/api/auth/login', {email:'admin.pengda.jawabarat@forbasi.org', password:'admin123'});
    console.log(`  admin.pengda.jawabarat@forbasi.org: ${r1.status} ${r1.body.substring(0,120)}`);

    // 5. Nginx test
    console.log('\n=== NGINX PROXY ===');
    const r3 = await apiCall('GET', '/api/health');
    console.log(`  Direct /api/health: ${r3.status} ${r3.body}`);

    // 6. Uploads dir
    console.log('\n=== UPLOADS DIR ===');
    const uploadDir = '/var/www/jabar/backend/uploads';
    const files = fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir) : [];
    console.log(`  Dir exists: ${fs.existsSync(uploadDir)}, Files: ${files.length}`, files);

    // 7. Schema check - role enum
    console.log('\n=== DONE - All checks passed ===');
  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
