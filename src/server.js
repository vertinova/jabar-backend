const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

// Apply any pending Prisma migrations on boot. The webhook deploy only runs
// `prisma generate` (not `migrate deploy`), so without this a new column/table
// would be missing on the live DB and routes using it would fail. `migrate
// deploy` is idempotent, so running it on every restart is safe.
try {
  const { execSync } = require('child_process');
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
    env: process.env,
  });
} catch (error) {
  // Never let a migration hiccup take the API offline — log and keep starting.
  console.error('⚠️  prisma migrate deploy failed on boot:', error.message);
}

const app = require('./app');

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Forbasi Jabar API running on port ${PORT}`);
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`📅 Started at ${new Date().toISOString()}`);
});
