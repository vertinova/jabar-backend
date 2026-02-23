const http = require('http');

const data = JSON.stringify({
  email: 'admin.pengda.jawabarat@forbasi.org',
  password: 'forbasi123'
});

const req = http.request({
  hostname: '127.0.0.1',
  port: 5023,
  path: '/api/auth/login',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
}, res => {
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    try {
      const j = JSON.parse(body);
      console.log('Message:', j.message);
      if (j.user) console.log('User:', JSON.stringify(j.user));
      if (j.token) console.log('Token:', j.token.substring(0, 50) + '...');
      if (j.error) console.log('Error:', j.error);
    } catch(e) {
      console.log('Body:', body.substring(0, 200));
    }
  });
});

req.on('error', e => console.error('Request failed:', e.message));
req.write(data);
req.end();
