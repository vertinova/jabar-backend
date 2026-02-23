const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection('mysql://root:PasswordBaruAnda@localhost:3306/forbasi_jabar');
  
  // Table counts
  const [tables] = await conn.query(`SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA='forbasi_jabar' ORDER BY TABLE_NAME`);
  console.log('=== TABLE COUNTS ===');
  tables.forEach(t => console.log(`  ${t.TABLE_NAME}: ${t.TABLE_ROWS} rows`));
  
  // Users
  const [users] = await conn.query('SELECT id, name, email, role FROM users');
  console.log('\n=== USERS ===');
  users.forEach(u => console.log(`  #${u.id} ${u.name} (${u.email}) - ${u.role}`));
  
  // Role enum
  const [cols] = await conn.query("SHOW COLUMNS FROM users WHERE Field='role'");
  console.log('\n=== ROLE ENUM ===');
  console.log('  ', cols[0].Type);
  
  // Pengcab
  const [pengcab] = await conn.query('SELECT id, nama, kota FROM pengcab');
  console.log('\n=== PENGCAB ===');
  pengcab.forEach(p => console.log(`  #${p.id} ${p.nama} - ${p.kota}`));
  
  // Kejurda
  const [kejurda] = await conn.query('SELECT id, nama, status FROM kejurda LIMIT 5');
  console.log('\n=== KEJURDA (last 5) ===');
  kejurda.forEach(k => console.log(`  #${k.id} ${k.nama} - ${k.status}`));
  
  // Test login
  const http = require('http');
  const loginTest = (email) => new Promise(resolve => {
    const data = JSON.stringify({email, password: 'admin123'});
    const req = http.request({hostname:'127.0.0.1',port:5023,path:'/api/auth/login',method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve({status:res.statusCode,body:d})); });
    req.write(data); req.end();
  });
  
  console.log('\n=== LOGIN TESTS ===');
  const r1 = await loginTest('admin.pengda.jawabarat@forbasi.org');
  console.log('  admin.pengda.jawabarat@forbasi.org:', r1.status, r1.body.substring(0,100));
  const r2 = await loginTest('admin@forbasi.or.id');
  console.log('  admin@forbasi.or.id:', r2.status, r2.body.substring(0,100));
  
  // Test API via nginx
  const https = require('https');
  const apiTest = () => new Promise(resolve => {
    https.get('https://jabar.forbasi.or.id/api/health', res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve({status:res.statusCode,body:d}));
    }).on('error', e => resolve({status:0,body:e.message}));
  });
  const r3 = await apiTest();
  console.log('\n=== NGINX API TEST ===');
  console.log('  /api/health:', r3.status, r3.body);
  
  await conn.end();
})();
