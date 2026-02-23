// Run this ON THE VPS: node test_upload_prod.js
const jwt = require('jsonwebtoken');
const fs = require('fs');
const http = require('http');
const path = require('path');

// Read JWT secret
const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
const match = env.match(/JWT_SECRET=(.+)/);
if (!match) { console.log('JWT_SECRET not found in .env'); process.exit(1); }
const secret = match[1].trim();
const token = jwt.sign({ id: 1, role: 'ADMIN' }, secret);
console.log('Token generated OK');

// Create a multipart form body manually
const boundary = '----TestBoundary123';
const filename = 'test-' + Date.now() + '.jpeg';
const fileContent = Buffer.from('fake-jpeg-for-testing');

const body = Buffer.concat([
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="gambar"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`),
  fileContent,
  Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\ncurl-test\r\n`),
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="urutan"\r\n\r\n1\r\n`),
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="aktif"\r\n\r\ntrue\r\n`),
  Buffer.from(`--${boundary}--\r\n`),
]);

const options = {
  hostname: '127.0.0.1',
  port: 5023,
  path: '/api/landing/hero-slides',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': body.length,
  },
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', data);
    
    // Check uploads dir
    const uploadsDir = path.join(__dirname, 'uploads');
    const files = fs.readdirSync(uploadsDir);
    console.log('Files in uploads:', files);
  });
});

req.on('error', e => console.error('Request error:', e.message));
req.write(body);
req.end();
