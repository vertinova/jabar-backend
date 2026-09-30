const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { hashKey } = require('../middleware/apiKey.middleware');

// Generate a cryptographically random API key
function generateApiKey() {
  const raw = 'fbsi_' + crypto.randomBytes(32).toString('hex'); // fbsi_ + 64 hex chars
  return raw;
}

// GET /api/api-keys — list all API keys (no raw key shown)
const listApiKeys = async (req, res) => {
  try {
    const keys = await prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        permissions: true,
        active: true,
        lastUsedAt: true,
        createdAt: true,
        _count: { select: { logs: true } },
      },
    });
    res.json(keys);
  } catch (error) {
    console.error('[ApiKey] listApiKeys error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

// POST /api/api-keys — create a new API key (raw key shown ONCE)
const createApiKey = async (req, res) => {
  try {
    const { name, permissions } = req.body;
    if (!name) return res.status(400).json({ error: 'Nama API key wajib diisi.' });

    const validPermissions = [
      'landing:read', 'landing:write', 'landing:delete',
      'pengcab:read', 'pengcab:write', 'pengcab:delete',
      'rekomendasi:read', 'rekomendasi:write', 'rekomendasi:delete',
      'kejurda:read', 'kejurda:write', 'kejurda:delete',
      'pendaftaran:read', 'pendaftaran:write', 'pendaftaran:delete',
      'users:read', 'users:write',
      'dashboard:read', 'dashboard:write',
      'dokumen:read', 'dokumen:write', 'dokumen:delete',
      'config:read', 'config:write',
    ];
    const perms = (permissions || ['landing:read']).filter(p => validPermissions.includes(p));

    const rawKey = generateApiKey();
    const keyH = hashKey(rawKey);
    const keyPrefix = rawKey.substring(0, 13) + '...'; // "fbsi_ab12cd34..."

    const apiKey = await prisma.apiKey.create({
      data: {
        name,
        keyHash: keyH,
        keyPrefix,
        permissions: perms,
      },
    });

    // Return raw key ONLY on creation
    res.status(201).json({
      id: apiKey.id,
      name: apiKey.name,
      key: rawKey, // shown ONCE
      keyPrefix: apiKey.keyPrefix,
      permissions: apiKey.permissions,
      active: apiKey.active,
      createdAt: apiKey.createdAt,
    });
  } catch (error) {
    console.error('[ApiKey] createApiKey error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

// PUT /api/api-keys/:id — update name, permissions, active status
const updateApiKey = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, permissions, active } = req.body;

    const data = {};
    if (name !== undefined) data.name = name;
    if (permissions !== undefined) {
      const validPermissions = [
        'landing:read', 'landing:write', 'landing:delete',
        'pengcab:read', 'pengcab:write', 'pengcab:delete',
        'rekomendasi:read', 'rekomendasi:write', 'rekomendasi:delete',
        'kejurda:read', 'kejurda:write', 'kejurda:delete',
        'pendaftaran:read', 'pendaftaran:write', 'pendaftaran:delete',
        'users:read', 'users:write',
        'dashboard:read', 'dashboard:write',
        'dokumen:read', 'dokumen:write', 'dokumen:delete',
        'config:read', 'config:write',
      ];
      data.permissions = permissions.filter(p => validPermissions.includes(p));
    }
    if (active !== undefined) data.active = Boolean(active);

    const apiKey = await prisma.apiKey.update({
      where: { id: parseInt(id) },
      data,
      select: {
        id: true, name: true, keyPrefix: true, permissions: true,
        active: true, lastUsedAt: true, createdAt: true,
      },
    });

    res.json(apiKey);
  } catch (error) {
    console.error('[ApiKey] updateApiKey error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

// DELETE /api/api-keys/:id — permanently delete an API key
const deleteApiKey = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.apiKey.delete({ where: { id: parseInt(id) } });
    res.json({ message: 'API key dihapus.' });
  } catch (error) {
    console.error('[ApiKey] deleteApiKey error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

// GET /api/api-keys/:id/logs — access logs for a specific key
const getApiKeyLogs = async (req, res) => {
  try {
    const { id } = req.params;
    const logs = await prisma.apiKeyLog.findMany({
      where: { apiKeyId: parseInt(id) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(logs);
  } catch (error) {
    console.error('[ApiKey] getApiKeyLogs error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

module.exports = { listApiKeys, createApiKey, updateApiKey, deleteApiKey, getApiKeyLogs };
