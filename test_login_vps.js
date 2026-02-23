const http = require('http');

function apiCall(path, body) {
  return new Promise(resolve => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port: 5023, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    req.write(data); req.end();
  });
}

(async () => {
  // Test 1: Login with FORBASI username (admin_pengda_jawabarat)
  console.log('=== TEST 1: Username login (admin_pengda_jawabarat) ===');
  const r1 = await apiCall('/api/auth/login', { email: 'admin_pengda_jawabarat', password: 'admin123' });
  console.log(`Status: ${r1.status}`);
  console.log(`Response: ${r1.body.substring(0, 300)}`);

  // Test 2: Login with email
  console.log('\n=== TEST 2: Email login (admin.pengda.jawabarat@forbasi.org) ===');
  const r2 = await apiCall('/api/auth/login', { email: 'admin.pengda.jawabarat@forbasi.org', password: 'admin123' });
  console.log(`Status: ${r2.status}`);
  console.log(`Response: ${r2.body.substring(0, 300)}`);

  // Test 3: Health check
  console.log('\n=== TEST 3: API Health ===');
  const http2 = require('http');
  const r3 = await new Promise(resolve => {
    http2.get('http://127.0.0.1:5023/api/health', res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', e => resolve({ status: 0, body: e.message }));
  });
  console.log(`Status: ${r3.status} - ${r3.body}`);

  // Test 4: PM2 logs check
  console.log('\n=== TEST 4: Check PM2 error logs ===');
  const { execSync } = require('child_process');
  try {
    const logs = execSync('pm2 logs 48 --nostream --lines 20 --err 2>&1', { encoding: 'utf8' });
    console.log(logs);
  } catch(e) {
    console.log('Could not get PM2 logs:', e.message);
  }
})();
