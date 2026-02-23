const prisma = require('../lib/prisma');
const fs = require('fs');
const path = require('path');

// ── Helper: resolve upload path from DB value ──
// DB stores "/uploads/filename.jpg", we resolve to absolute filesystem path
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

function resolveFilePath(dbPath) {
  if (!dbPath) return null;
  const filename = dbPath.replace(/^\/uploads\//, '');
  return path.join(UPLOAD_DIR, filename);
}

function safeDeleteFile(dbPath) {
  try {
    const filePath = resolveFilePath(dbPath);
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[Landing] Deleted file: ${filePath}`);
    }
  } catch (err) {
    console.error(`[Landing] Failed to delete file: ${dbPath}`, err.message);
  }
}

// Verify a multer-uploaded file actually exists on disk
function verifyUpload(file) {
  if (!file) return false;
  const fullPath = path.join(UPLOAD_DIR, file.filename);
  const exists = fs.existsSync(fullPath);
  if (!exists) {
    console.error('[Landing] CRITICAL: multer reported file but not found at:', fullPath);
  } else {
    console.log('[Landing] Upload verified:', file.filename, 'size:', fs.statSync(fullPath).size);
  }
  return exists;
}

// ══════════════════════════════════════════
// HERO SLIDES
// ══════════════════════════════════════════
const getHeroSlides = async (req, res) => {
  try {
    const slides = await prisma.heroSlide.findMany({ orderBy: { urutan: 'asc' } });
    res.json(slides);
  } catch (error) {
    console.error('[Landing] getHeroSlides error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

const createHeroSlide = async (req, res) => {
  try {
    console.log('[Landing] createHeroSlide - file:', req.file?.filename || 'NONE', 'body:', JSON.stringify(req.body));

    if (!req.file) return res.status(400).json({ error: 'Gambar wajib diupload' });
    if (!verifyUpload(req.file)) {
      return res.status(500).json({ error: 'File gagal disimpan ke disk' });
    }

    const slide = await prisma.heroSlide.create({
      data: {
        gambar: `/uploads/${req.file.filename}`,
        caption: req.body.caption || null,
        urutan: parseInt(req.body.urutan) || 0,
        aktif: req.body.aktif !== 'false',
      }
    });

    console.log('[Landing] Hero slide created: id=%d gambar=%s', slide.id, slide.gambar);
    res.status(201).json(slide);
  } catch (error) {
    console.error('[Landing] createHeroSlide error:', error);
    res.status(500).json({ error: error.message });
  }
};

const updateHeroSlide = async (req, res) => {
  try {
    const { id } = req.params;
    console.log('[Landing] updateHeroSlide id:', id, 'hasFile:', !!req.file);

    const data = {};
    if (req.body.caption !== undefined) data.caption = req.body.caption || null;
    if (req.body.urutan !== undefined) data.urutan = parseInt(req.body.urutan) || 0;
    if (req.body.aktif !== undefined) data.aktif = req.body.aktif === 'true';

    if (req.file) {
      if (!verifyUpload(req.file)) {
        return res.status(500).json({ error: 'File gagal disimpan ke disk' });
      }
      const old = await prisma.heroSlide.findUnique({ where: { id: parseInt(id) } });
      if (old?.gambar) safeDeleteFile(old.gambar);
      data.gambar = `/uploads/${req.file.filename}`;
    }

    const slide = await prisma.heroSlide.update({ where: { id: parseInt(id) }, data });
    console.log('[Landing] Hero slide updated:', slide.id);
    res.json(slide);
  } catch (error) {
    console.error('[Landing] updateHeroSlide error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

const deleteHeroSlide = async (req, res) => {
  try {
    const { id } = req.params;
    const slide = await prisma.heroSlide.findUnique({ where: { id: parseInt(id) } });
    if (!slide) return res.status(404).json({ error: 'Slide tidak ditemukan' });

    safeDeleteFile(slide.gambar);
    await prisma.heroSlide.delete({ where: { id: parseInt(id) } });
    console.log('[Landing] Hero slide deleted:', id);
    res.json({ message: 'Slide dihapus' });
  } catch (error) {
    console.error('[Landing] deleteHeroSlide error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

// ══════════════════════════════════════════
// BERITA
// ══════════════════════════════════════════
const getBerita = async (req, res) => {
  try {
    const berita = await prisma.berita.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(berita);
  } catch (error) {
    console.error('[Landing] getBerita error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

const getBeritaById = async (req, res) => {
  try {
    const berita = await prisma.berita.findUnique({ where: { id: parseInt(req.params.id) } });
    if (!berita) return res.status(404).json({ error: 'Berita tidak ditemukan' });
    res.json(berita);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createBerita = async (req, res) => {
  try {
    console.log('[Landing] createBerita, file:', req.file?.filename || 'none');
    const data = {
      judul: req.body.judul,
      ringkasan: req.body.ringkasan || null,
      konten: req.body.konten || null,
      penulis: req.body.penulis || null,
      aktif: req.body.aktif !== 'false',
    };
    if (req.file) {
      if (!verifyUpload(req.file)) {
        return res.status(500).json({ error: 'File gagal disimpan ke disk' });
      }
      data.gambar = `/uploads/${req.file.filename}`;
    }
    const berita = await prisma.berita.create({ data });
    console.log('[Landing] Berita created:', berita.id);
    res.status(201).json(berita);
  } catch (error) {
    console.error('[Landing] createBerita error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

const updateBerita = async (req, res) => {
  try {
    const { id } = req.params;
    const data = {};
    if (req.body.judul !== undefined) data.judul = req.body.judul;
    if (req.body.ringkasan !== undefined) data.ringkasan = req.body.ringkasan || null;
    if (req.body.konten !== undefined) data.konten = req.body.konten || null;
    if (req.body.penulis !== undefined) data.penulis = req.body.penulis || null;
    if (req.body.aktif !== undefined) data.aktif = req.body.aktif === 'true';
    if (req.file) {
      if (!verifyUpload(req.file)) {
        return res.status(500).json({ error: 'File gagal disimpan ke disk' });
      }
      const old = await prisma.berita.findUnique({ where: { id: parseInt(id) } });
      if (old?.gambar) safeDeleteFile(old.gambar);
      data.gambar = `/uploads/${req.file.filename}`;
    }
    const berita = await prisma.berita.update({ where: { id: parseInt(id) }, data });
    res.json(berita);
  } catch (error) {
    console.error('[Landing] updateBerita error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

const deleteBerita = async (req, res) => {
  try {
    const { id } = req.params;
    const b = await prisma.berita.findUnique({ where: { id: parseInt(id) } });
    if (!b) return res.status(404).json({ error: 'Berita tidak ditemukan' });
    if (b.gambar) safeDeleteFile(b.gambar);
    await prisma.berita.delete({ where: { id: parseInt(id) } });
    res.json({ message: 'Berita dihapus' });
  } catch (error) {
    console.error('[Landing] deleteBerita error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

// ══════════════════════════════════════════
// FEEDBACK
// ══════════════════════════════════════════
const getFeedback = async (req, res) => {
  try {
    const feedback = await prisma.feedback.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(feedback);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const submitFeedback = async (req, res) => {
  try {
    const { nama, email, pesan } = req.body;
    if (!nama || !email || !pesan) return res.status(400).json({ error: 'Semua field wajib diisi' });
    const feedback = await prisma.feedback.create({ data: { nama, email, pesan } });
    res.status(201).json({ message: 'Terima kasih atas masukan Anda!', id: feedback.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const markFeedbackRead = async (req, res) => {
  try {
    const feedback = await prisma.feedback.update({
      where: { id: parseInt(req.params.id) },
      data: { dibaca: true }
    });
    res.json(feedback);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteFeedback = async (req, res) => {
  try {
    await prisma.feedback.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ message: 'Feedback dihapus' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ══════════════════════════════════════════
// SITE CONFIG
// ══════════════════════════════════════════
const getSiteConfig = async (req, res) => {
  try {
    const configs = await prisma.siteConfig.findMany();
    const result = {};
    configs.forEach(c => { result[c.key] = c.value; });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateSiteConfig = async (req, res) => {
  try {
    const entries = req.body;
    const ops = Object.entries(entries).map(([key, value]) =>
      prisma.siteConfig.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      })
    );
    await Promise.all(ops);
    res.json({ message: 'Konfigurasi disimpan' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ══════════════════════════════════════════
// STRUKTUR ORGANISASI
// ══════════════════════════════════════════
const getStruktur = async (req, res) => {
  try {
    const struktur = await prisma.strukturOrganisasi.findMany({ orderBy: { urutan: 'asc' } });
    res.json(struktur);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createStruktur = async (req, res) => {
  try {
    const { jabatan, nama, urutan, aktif } = req.body;
    if (!jabatan || !nama) return res.status(400).json({ error: 'Jabatan dan nama wajib diisi' });
    const data = {
      jabatan,
      nama,
      urutan: parseInt(urutan) || 0,
      aktif: aktif !== 'false',
    };
    if (req.file) {
      if (!verifyUpload(req.file)) {
        return res.status(500).json({ error: 'File gagal disimpan ke disk' });
      }
      data.foto = `/uploads/${req.file.filename}`;
    }
    const struktur = await prisma.strukturOrganisasi.create({ data });
    console.log('[Landing] Struktur created:', struktur.id);
    res.status(201).json(struktur);
  } catch (error) {
    console.error('[Landing] createStruktur error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

const updateStruktur = async (req, res) => {
  try {
    const { id } = req.params;
    const data = {};
    if (req.body.jabatan !== undefined) data.jabatan = req.body.jabatan;
    if (req.body.nama !== undefined) data.nama = req.body.nama;
    if (req.body.urutan !== undefined) data.urutan = parseInt(req.body.urutan) || 0;
    if (req.body.aktif !== undefined) data.aktif = req.body.aktif === 'true';
    if (req.file) {
      if (!verifyUpload(req.file)) {
        return res.status(500).json({ error: 'File gagal disimpan ke disk' });
      }
      const old = await prisma.strukturOrganisasi.findUnique({ where: { id: parseInt(id) } });
      if (old?.foto) safeDeleteFile(old.foto);
      data.foto = `/uploads/${req.file.filename}`;
    }
    const struktur = await prisma.strukturOrganisasi.update({ where: { id: parseInt(id) }, data });
    res.json(struktur);
  } catch (error) {
    console.error('[Landing] updateStruktur error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

const deleteStruktur = async (req, res) => {
  try {
    const { id } = req.params;
    const s = await prisma.strukturOrganisasi.findUnique({ where: { id: parseInt(id) } });
    if (!s) return res.status(404).json({ error: 'Data tidak ditemukan' });
    if (s.foto) safeDeleteFile(s.foto);
    await prisma.strukturOrganisasi.delete({ where: { id: parseInt(id) } });
    res.json({ message: 'Struktur organisasi dihapus' });
  } catch (error) {
    console.error('[Landing] deleteStruktur error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

// ── Debug: check upload health ──
const checkUploadHealth = async (req, res) => {
  try {
    const exists = fs.existsSync(UPLOAD_DIR);
    const writable = exists && (() => {
      try {
        const testFile = path.join(UPLOAD_DIR, '.write-test');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        return true;
      } catch { return false; }
    })();
    const files = exists ? fs.readdirSync(UPLOAD_DIR) : [];

    // Check DB records vs actual files
    const heroSlides = await prisma.heroSlide.findMany({ select: { id: true, gambar: true } });
    const orphanSlides = heroSlides.filter(s => {
      const fp = resolveFilePath(s.gambar);
      return fp && !fs.existsSync(fp);
    });

    res.json({
      uploadDir: UPLOAD_DIR,
      exists,
      writable,
      fileCount: files.length,
      files: files.slice(0, 20),
      heroSlidesInDB: heroSlides.length,
      orphanSlides: orphanSlides.map(s => ({ id: s.id, gambar: s.gambar })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  // Hero
  getHeroSlides, createHeroSlide, updateHeroSlide, deleteHeroSlide,
  // Berita
  getBerita, getBeritaById, createBerita, updateBerita, deleteBerita,
  // Feedback
  getFeedback, submitFeedback, markFeedbackRead, deleteFeedback,
  // Config
  getSiteConfig, updateSiteConfig,
  // Struktur Organisasi
  getStruktur, createStruktur, updateStruktur, deleteStruktur,
  // Debug
  checkUploadHealth,
};
