const crypto = require('crypto');
const prisma = require('../lib/prisma');

// In-memory rate limiter: map of keyHash -> { count, resetAt }
const rateLimits = new Map();
const RATE_LIMIT = 100; // max requests per window
const RATE_WINDOW = 60 * 1000; // 1 minute

function hashKey(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Middleware: authenticate via X-API-Key header.
 * Attaches req.apiClient = { id, name, permissions } on success.
 */
const authenticateApiKey = async (req, res, next) => {
  const raw = req.headers['x-api-key'];
  if (!raw) {
    return res.status(401).json({ error: 'API key tidak ditemukan. Sertakan header X-API-Key.' });
  }

  try {
    const keyHash = hashKey(raw);

    // Rate limiting
    const now = Date.now();
    let rl = rateLimits.get(keyHash);
    if (!rl || now > rl.resetAt) {
      rl = { count: 0, resetAt: now + RATE_WINDOW };
      rateLimits.set(keyHash, rl);
    }
    rl.count++;
    if (rl.count > RATE_LIMIT) {
      return res.status(429).json({ error: 'Rate limit exceeded. Maksimal 100 request/menit.' });
    }

    const apiKey = await prisma.apiKey.findUnique({ where: { keyHash } });
    if (!apiKey) {
      return res.status(401).json({ error: 'API key tidak valid.' });
    }
    if (!apiKey.active) {
      return res.status(403).json({ error: 'API key sudah dinonaktifkan.' });
    }

    // Update lastUsedAt (fire-and-forget)
    prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

    // Log access (fire-and-forget)
    prisma.apiKeyLog.create({
      data: {
        apiKeyId: apiKey.id,
        endpoint: req.originalUrl,
        method: req.method,
        ip: req.ip || req.headers['x-forwarded-for'] || null,
        userAgent: req.headers['user-agent'] || null,
      }
    }).catch(() => {});

    req.apiClient = {
      id: apiKey.id,
      name: apiKey.name,
      permissions: apiKey.permissions || [],
    };

    // Set req.user for controllers that expect it (e.g. rekomendasi)
    // External API requests from Pusat act as ADMIN
    if (!req.user) {
      req.user = {
        id: null,
        role: 'ADMIN',
        name: apiKey.name || 'External API',
      };
    }

    next();
  } catch (error) {
    console.error('[ApiKey] Auth error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Factory: check if the API client has a specific permission.
 * Usage: requirePermission('landing:write')
 */
const requirePermission = (permission) => (req, res, next) => {
  const perms = req.apiClient?.permissions || [];
  if (!perms.includes(permission)) {
    return res.status(403).json({ error: `Permission '${permission}' diperlukan.` });
  }
  next();
};

module.exports = { authenticateApiKey, requirePermission, hashKey };
