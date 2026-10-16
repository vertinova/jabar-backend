/**
 * FORBASI Jabar – GitHub Webhook Auto-Deploy Server
 *
 *   pm2 start /var/www/jabar/webhook/server.js --name jabar-webhook
 *
 * Konfigurasi dibaca dari /var/www/jabar/webhook/.env (chmod 600), BUKAN dari
 * kode — secret yang tertulis di kode ikut ter-commit dan bocor ke siapa pun
 * yang bisa membaca repo:
 *
 *   WEBHOOK_SECRET=<secret>        # wajib; boleh beberapa, pisahkan koma
 *   WEBHOOK_PORT=9000
 *   DEPLOY_BRANCH=main
 *
 * Beberapa secret sekaligus hanya untuk masa rotasi: secret baru dipasang di
 * sini bersama yang lama, GitHub diperbarui, lalu yang lama dihapus — tanpa
 * jeda di mana push ditolak.
 *
 * Tanpa secret server menolak berjalan. Dulu secret kosong berarti semua
 * request lolos, dan siapa pun bisa memicu deploy.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');

// Pemuat .env minimal — folder ini tidak punya node_modules.
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const SECRETS = String(process.env.WEBHOOK_SECRET || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const PORT = Number(process.env.WEBHOOK_PORT || 9000);
const DEPLOY_BRANCH = process.env.DEPLOY_BRANCH || 'main';
const DEPLOY_SCRIPT = '/var/www/jabar/repos/backend/deploy.sh';

if (!SECRETS.length) {
  console.error('WEBHOOK_SECRET belum di-set di /var/www/jabar/webhook/.env — server webhook tidak dijalankan.');
  process.exit(1);
}

let deploying = false;
const queue = [];

function verifySignature(payload, signature) {
  if (!signature || typeof signature !== 'string') return false;
  const sigBuf = Buffer.from(signature);

  return SECRETS.some((secret) => {
    const digBuf = Buffer.from('sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex'));
    return sigBuf.length === digBuf.length && crypto.timingSafeEqual(sigBuf, digBuf);
  });
}

function enqueueDeploy(target) {
  if (!queue.includes(target)) queue.push(target);
  runNextDeploy();
}

function runNextDeploy() {
  if (deploying || queue.length === 0) return;

  const target = queue.shift();
  deploying = true;

  console.log(`Starting deploy for ${target}...`);
  execFile('bash', [DEPLOY_SCRIPT, target], {
    cwd: '/var/www/jabar/repos/backend',
    timeout: 600000,
  }, (err, stdout, stderr) => {
    deploying = false;

    if (err) {
      console.error(`Deploy ${target} failed:`, err.message);
      if (stderr) console.error(stderr);
    } else {
      console.log(`Deploy ${target} completed successfully`);
    }

    if (stdout) console.log(stdout);
    runNextDeploy();
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', deploying, queue, uptime: process.uptime() }));
    return;
  }

  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', () => {
    const signature = req.headers['x-hub-signature-256'];
    if (!verifySignature(body, signature)) {
      console.log('Invalid webhook signature from', req.headers['x-real-ip'] || req.socket.remoteAddress);
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const event = req.headers['x-github-event'];
    if (event === 'ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ msg: 'pong' }));
      return;
    }

    if (event !== 'push') {
      res.writeHead(200);
      res.end('OK - ignored');
      return;
    }

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end('Bad Request');
      return;
    }

    const branch = String(payload.ref || '').replace('refs/heads/', '');
    if (branch !== DEPLOY_BRANCH) {
      res.writeHead(200);
      res.end('OK - not target branch');
      return;
    }

    const repo = payload.repository?.name || '';
    let target = null;

    if (repo === 'forbasi-jabar') target = 'frontend';
    if (repo === 'jabar-backend') target = 'backend';

    if (!target) {
      res.writeHead(200);
      res.end(`OK - unknown repo ${repo}`);
      return;
    }

    console.log(`Webhook received: ${repo} -> queued ${target}`);
    enqueueDeploy(target);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ msg: `Deploy queued for ${target}`, queue, deploying }));
  });
});

server.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);
  console.log(`Deploy branch: ${DEPLOY_BRANCH}`);
  console.log(`Secret: ${SECRETS.length} terpasang dari .env`);
});
