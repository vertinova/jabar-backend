/**
 * Seed API key dari FORBASI Pusat
 * Jalankan: node prisma/seed_apikey.js
 */
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PUSAT_KEY = 'fbsi_0801e38ed9268caed09d634ab0d91270bb8ac66b139c7af91d62dfe96122b44d';

async function main() {
  const keyHash = crypto.createHash('sha256').update(PUSAT_KEY).digest('hex');
  const keyPrefix = PUSAT_KEY.substring(0, 13) + '...';

  // All permissions
  const allPermissions = [
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

  const existing = await prisma.apiKey.findUnique({ where: { keyHash } });
  if (existing) {
    console.log('API key FORBASI Pusat sudah ada (id:', existing.id, ')');
    // Update permissions to full access
    await prisma.apiKey.update({
      where: { id: existing.id },
      data: { permissions: allPermissions, active: true },
    });
    console.log('Permissions diupdate ke full access.');
  } else {
    const key = await prisma.apiKey.create({
      data: {
        name: 'FORBASI Pusat',
        keyHash,
        keyPrefix,
        permissions: allPermissions,
        active: true,
      },
    });
    console.log('API key FORBASI Pusat berhasil dibuat! ID:', key.id);
  }

  console.log('Key prefix:', keyPrefix);
  console.log('Permissions:', allPermissions.length, 'total');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
