const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth.routes');
const pengcabRoutes = require('./routes/pengcab.routes');
const rekomendasiRoutes = require('./routes/rekomendasi.routes');
const kejurdaRoutes = require('./routes/kejurda.routes');
const pendaftaranRoutes = require('./routes/pendaftaran.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const pengcabPanelRoutes = require('./routes/pengcabPanel.routes');
const adminUserRoutes = require('./routes/adminUser.routes');
const kategoriEventRoutes = require('./routes/kategoriEvent.routes');
const landingConfigRoutes = require('./routes/landingConfig.routes');
const formatDokumenRoutes = require('./routes/formatDokumen.routes');
const siteConfigRoutes = require('./routes/siteConfig.routes');
const simpaskorRoutes = require('./routes/simpaskor.routes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/pengcab', pengcabRoutes);
app.use('/api/rekomendasi', rekomendasiRoutes);
app.use('/api/kejurda', kejurdaRoutes);
app.use('/api/pendaftaran', pendaftaranRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/pengcab-panel', pengcabPanelRoutes);
app.use('/api/admin-users', adminUserRoutes);
app.use('/api/kategori-event', kategoriEventRoutes);
app.use('/api/landing', landingConfigRoutes);
app.use('/api/format-dokumen', formatDokumenRoutes);
app.use('/api/site-config', siteConfigRoutes);
app.use('/api/simpaskor', simpaskorRoutes);

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const prisma = require('./lib/prisma');
    // Quick DB check
    const result = await prisma.$queryRaw`SELECT 1 as ok`;
    const migrations = await prisma.$queryRaw`SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 3`;
    res.json({
      success: true,
      message: 'Server is running',
      timestamp: new Date().toISOString(),
      db: 'connected',
      latestMigrations: migrations.map(m => m.migration_name)
    });
  } catch (err) {
    res.json({
      success: true,
      message: 'Server is running',
      timestamp: new Date().toISOString(),
      db: 'error',
      dbError: err.message
    });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

module.exports = app;
