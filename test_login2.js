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
  // Correct credentials from user
  console.log('=== Login: admin_pengda_jawa_barat / forbasi123 ===');
  const r1 = await apiCall('/api/auth/login', { email: 'admin_pengda_jawa_barat', password: 'forbasi123' });
  console.log(`Status: ${r1.status}`);
  try {
    const parsed = JSON.parse(r1.body);
    if (parsed.token) {
      console.log('LOGIN SUCCESS!');
      console.log(`User: ${parsed.user.name} (${parsed.user.email})`);
      console.log(`Role: ${parsed.user.role}`);
      console.log(`Token: ${parsed.token.substring(0, 50)}...`);
      
      // Test authenticated endpoint
      const profileReq = await new Promise(resolve => {
        const req2 = http.request({
          hostname: '127.0.0.1', port: 5023, path: '/api/auth/profile', method: 'GET',
          headers: { 'Authorization': `Bearer ${parsed.token}` }
        }, res => {
          let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
        });
        req2.on('error', e => resolve({ status: 0, body: e.message }));
        req2.end();
      });
      console.log(`\nProfile check: ${profileReq.status} - ${profileReq.body.substring(0, 200)}`);
    } else {
      console.log('LOGIN FAILED:', JSON.stringify(parsed, null, 2));
    }
  } catch(e) {
    console.log('Raw response:', r1.body);
  }
})();
