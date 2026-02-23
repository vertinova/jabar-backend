// Quick VPS diagnostic - run: node /tmp/vps_check.js
const http = require('http');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port: 5023, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(path, token) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request({
      hostname: '127.0.0.1', port: 5023, path, method: 'GET', headers
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  console.log('=== 1. API Health ===');
  const h = await get('/api/health');
  console.log(h.status, h.body);

  console.log('\n=== 2. Login test ===');
  const login = await post('/api/auth/login', { email: 'admin@forbasi.or.id', password: 'admin123' });
  console.log(login.status, login.body.substring(0, 200));

  let token = null;
  try {
    const parsed = JSON.parse(login.body);
    token = parsed.token;
    if (token) console.log('Token OK:', token.substring(0, 30) + '...');
    else console.log('No token - login failed');
  } catch(e) { console.log('Parse error'); }

  console.log('\n=== 3. Check users ===');
  const mysql = require('child_process').execSync(
    "mysql -u root -pPasswordBaruAnda forbasi_jabar -e \"SELECT id, nama, email, role FROM users LIMIT 10;\" 2>/dev/null"
  ).toString();
  console.log(mysql);

  console.log('=== 4. Check hero_slides ===');
  const slides = await get('/api/landing/hero-slides', token);
  console.log(slides.status, slides.body.substring(0, 200));

  console.log('\n=== 5. Check uploads dir ===');
  const fs = require('fs');
  const path = require('path');
  const uploadDir = '/var/www/jabar/backend/uploads';
  const files = fs.readdirSync(uploadDir);
  console.log('Files:', files.length, files);

  console.log('\n=== 6. DB record counts ===');
  const counts = require('child_process').execSync(
    "mysql -u root -pPasswordBaruAnda forbasi_jabar -e \"SELECT 'users' as tbl, COUNT(*) as cnt FROM users UNION ALL SELECT 'hero_slides', COUNT(*) FROM hero_slides UNION ALL SELECT 'berita', COUNT(*) FROM berita UNION ALL SELECT 'kejurda', COUNT(*) FROM kejurda UNION ALL SELECT 'pengcab', COUNT(*) FROM pengcab UNION ALL SELECT 'feedback', COUNT(*) FROM feedback UNION ALL SELECT 'struktur_organisasi', COUNT(*) FROM struktur_organisasi UNION ALL SELECT 'site_config', COUNT(*) FROM site_config;\" 2>/dev/null"
  ).toString();
  console.log(counts);

  console.log('=== 7. Nginx proxy test ===');
  const https = require('https');
  const nreq = https.request({ hostname: 'jabar.forbasi.or.id', path: '/api/health', method: 'GET' }, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
      console.log('Nginx -> API:', res.statusCode, d);
      console.log('\n=== DONE ===');
    });
  });
  nreq.on('error', e => console.log('Nginx error:', e.message));
  nreq.end();
})();
