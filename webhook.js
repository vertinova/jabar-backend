/**
 * GitHub Webhook Auto-Deploy Server
 * 
 * Listens for GitHub push events and triggers deployment.
 * Runs as a SEPARATE process from the main backend app so it
 * stays alive even when the backend restarts during deploy.
 * 
 * Usage:
 *   node webhook.js
 *   # or with PM2:
 *   pm2 start webhook.js --name jabar-webhook
 * 
 * Environment variables (in .env):
 *   WEBHOOK_SECRET  – GitHub webhook secret (required for security)
 *   WEBHOOK_PORT    – Port to listen on (default: 9000)
 *   DEPLOY_BRANCH   – Branch to deploy (default: main)
 */

require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');
const path = require('path');

const PORT = parseInt(process.env.WEBHOOK_PORT, 10) || 9000;
const SECRET = process.env.WEBHOOK_SECRET || '';
const DEPLOY_BRANCH = process.env.DEPLOY_BRANCH || 'main';

// ── Helpers ─────────────────────────────────────────────────

function verifySignature(payload, signature) {
  if (!SECRET) {
    console.warn('⚠️  WEBHOOK_SECRET not set – skipping signature verification (NOT recommended for production)');
    return true;
  }
  if (!signature) return false;

  const hmac = crypto.createHmac('sha256', SECRET);
  hmac.update(payload);
  const digest = 'sha256=' + hmac.digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

let deploying = false;

function runDeploy(repo) {
  if (deploying) {
    console.log('⏳ Deploy already in progress, skipping...');
    return;
  }
  deploying = true;

  const scriptPath = '/var/www/jabar/repos/backend/deploy.sh';
  console.log(`\n🚀 Starting deploy for ${repo}...`);

  execFile('bash', [scriptPath, repo], { cwd: '/var/www/jabar/repos/backend', timeout: 300000 }, (err, stdout, stderr) => {
    deploying = false;
    if (err) {
      console.error('❌ Deploy failed:', err.message);
      if (stderr) console.error('STDERR:', stderr);
    } else {
      console.log('✅ Deploy completed successfully');
    }
    if (stdout) console.log(stdout);
  });
}

// ── HTTP Server ─────────────────────────────────────────────

const server = http.createServer((req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/webhook/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', deploying }));
    return;
  }

  // Only accept POST /webhook
  if (req.method !== 'POST' || !req.url.startsWith('/webhook')) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    // Verify signature
    const sig = req.headers['x-hub-signature-256'];
    if (!verifySignature(body, sig)) {
      console.warn('⛔ Invalid webhook signature');
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // Parse event
    const event = req.headers['x-github-event'];
    if (event === 'ping') {
      console.log('🏓 Ping received from GitHub');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ msg: 'pong' }));
      return;
    }

    if (event !== 'push') {
      console.log(`ℹ️  Ignoring event: ${event}`);
      res.writeHead(200);
      res.end('OK - ignored');
      return;
    }

    // Parse payload
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end('Bad Request');
      return;
    }

    // Check branch
    const branch = (payload.ref || '').replace('refs/heads/', '');
    if (branch !== DEPLOY_BRANCH) {
      console.log(`ℹ️  Push to ${branch}, not ${DEPLOY_BRANCH} – skipping`);
      res.writeHead(200);
      res.end('OK - not target branch');
      return;
    }

    // Determine which repo (backend / frontend)
    const repoName = (payload.repository && payload.repository.name) || '';
    let target = 'backend'; // default
    if (repoName === 'forbasi-jabar' || repoName.includes('frontend')) {
      target = 'frontend';
    }

    console.log(`📦 Push to ${branch} on ${repoName} → deploying ${target}`);
    runDeploy(target);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ msg: `Deploy triggered for ${target}` }));
  });
});

server.listen(PORT, () => {
  console.log(`🔗 Webhook server listening on port ${PORT}`);
  console.log(`   Deploy branch: ${DEPLOY_BRANCH}`);
  console.log(`   Secret: ${SECRET ? 'configured ✅' : 'NOT SET ⚠️'}`);
});
