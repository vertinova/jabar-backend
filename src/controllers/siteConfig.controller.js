const prisma = require('../lib/prisma');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '..', '..', 'uploads');

// Get a site config by key
const getConfig = async (req, res) => {
  try {
    const config = await prisma.siteConfig.findUnique({ where: { key: req.params.key } });
    if (!config) return res.json({ key: req.params.key, value: null });
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil konfigurasi', detail: error.message });
  }
};

// Get all site configs
const getAllConfigs = async (req, res) => {
  try {
    const configs = await prisma.siteConfig.findMany();
    const map = {};
    configs.forEach(c => { map[c.key] = c.value; });
    res.json(map);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil konfigurasi', detail: error.message });
  }
};

// Save signature (drawn on canvas, sent as base64 dataURL) + signer name
// role: 'ketua' or 'sekretaris'
const saveSignature = async (req, res) => {
  try {
    const { signatureData, signerName, role } = req.body;
    if (!signatureData) return res.status(400).json({ error: 'Data tanda tangan wajib diisi' });
    if (!signerName) return res.status(400).json({ error: 'Nama penandatangan wajib diisi' });

    const signerRole = (role === 'sekretaris') ? 'sekretaris' : 'ketua';
    const configKey = `tanda_tangan_${signerRole}`;

    // Save signature as image file from base64
    const base64Data = signatureData.replace(/^data:image\/\w+;base64,/, '');
    const signatureFilename = `signature-${signerRole}-${Date.now()}.png`;
    const signaturePath = path.join(uploadDir, signatureFilename);
    fs.writeFileSync(signaturePath, Buffer.from(base64Data, 'base64'));

    const value = {
      signaturePath: `/uploads/${signatureFilename}`,
      signerName: signerName.trim(),
      role: signerRole,
      updatedAt: new Date().toISOString(),
    };

    await prisma.siteConfig.upsert({
      where: { key: configKey },
      create: { key: configKey, value },
      update: { value },
    });

    res.json({ message: `Tanda tangan ${signerRole} berhasil disimpan`, value });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menyimpan tanda tangan', detail: error.message });
  }
};

// Save stamp (uploaded image file)
const saveStamp = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File stempel wajib diupload' });

    const stampPath = `/uploads/${req.file.filename}`;

    const value = {
      stampPath,
      updatedAt: new Date().toISOString(),
    };

    await prisma.siteConfig.upsert({
      where: { key: 'stempel' },
      create: { key: 'stempel', value },
      update: { value },
    });

    res.json({ message: 'Stempel berhasil disimpan', value });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menyimpan stempel', detail: error.message });
  }
};

// Get signature + stamp config for surat generation (2 signers + stamp)
const getSuratConfig = async (req, res) => {
  try {
    const configs = await prisma.siteConfig.findMany({
      where: { key: { in: ['tanda_tangan_ketua', 'tanda_tangan_sekretaris', 'stempel'] } }
    });
    const result = {};
    configs.forEach(c => { result[c.key] = c.value; });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil konfigurasi surat', detail: error.message });
  }
};

module.exports = { getConfig, getAllConfigs, saveSignature, saveStamp, getSuratConfig };
