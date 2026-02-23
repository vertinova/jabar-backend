const prisma = require('../lib/prisma');
const fs = require('fs');
const path = require('path');

// ══════════════════════════════════════════
// HERO SLIDES
// ══════════════════════════════════════════
const getHeroSlides = async (req, res) => {
  try {
    const slides = await prisma.heroSlide.findMany({ orderBy: { urutan: 'asc' } });
    res.json(slides);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const createHeroSlide = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Gambar wajib diupload' });
    const slide = await prisma.heroSlide.create({
      data: {
        gambar: `/uploads/${req.file.filename}`,
        caption: req.body.caption || null,
        urutan: parseInt(req.body.urutan) || 0,
        aktif: req.body.aktif !== 'false',
      }
    });
    res.status(201).json(slide);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateHeroSlide = async (req, res) => {
  try {
    const { id } = req.params;
    const data = {};
    if (req.body.caption !== undefined) data.caption = req.body.caption || null;
    if (req.body.urutan !== undefined) data.urutan = parseInt(req.body.urutan) || 0;
    if (req.body.aktif !== undefined) data.aktif = req.body.aktif === 'true';
    if (req.file) {
      // Delete old image
      const old = await prisma.heroSlide.findUnique({ where: { id: parseInt(id) } });
      if (old?.gambar) {
        const oldPath = path.join(__dirname, '..', '..', old.gambar);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      data.gambar = `/uploads/${req.file.filename}`;
    }
    const slide = await prisma.heroSlide.update({ where: { id: parseInt(id) }, data });
    res.json(slide);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteHeroSlide = async (req, res) => {
  try {
    const { id } = req.params;
    const slide = await prisma.heroSlide.findUnique({ where: { id: parseInt(id) } });
    if (slide?.gambar) {
      const filePath = path.join(__dirname, '..', '..', slide.gambar);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await prisma.heroSlide.delete({ where: { id: parseInt(id) } });
    res.json({ message: 'Slide dihapus' });
  } catch (error) {
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
    const data = {
      judul: req.body.judul,
      ringkasan: req.body.ringkasan || null,
      konten: req.body.konten || null,
      penulis: req.body.penulis || null,
      aktif: req.body.aktif !== 'false',
    };
    if (req.file) data.gambar = `/uploads/${req.file.filename}`;
    const berita = await prisma.berita.create({ data });
    res.status(201).json(berita);
  } catch (error) {
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
      const old = await prisma.berita.findUnique({ where: { id: parseInt(id) } });
      if (old?.gambar) {
        const oldPath = path.join(__dirname, '..', '..', old.gambar);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      data.gambar = `/uploads/${req.file.filename}`;
    }
    const berita = await prisma.berita.update({ where: { id: parseInt(id) }, data });
    res.json(berita);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteBerita = async (req, res) => {
  try {
    const { id } = req.params;
    const b = await prisma.berita.findUnique({ where: { id: parseInt(id) } });
    if (b?.gambar) {
      const filePath = path.join(__dirname, '..', '..', b.gambar);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await prisma.berita.delete({ where: { id: parseInt(id) } });
    res.json({ message: 'Berita dihapus' });
  } catch (error) {
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
    const entries = req.body; // { key1: value1, key2: value2, ... }
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

module.exports = {
  // Hero
  getHeroSlides, createHeroSlide, updateHeroSlide, deleteHeroSlide,
  // Berita
  getBerita, getBeritaById, createBerita, updateBerita, deleteBerita,
  // Feedback
  getFeedback, submitFeedback, markFeedbackRead, deleteFeedback,
  // Config
  getSiteConfig, updateSiteConfig,
};
