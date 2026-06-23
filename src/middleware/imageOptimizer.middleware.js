const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');

const uploadDir = path.join(__dirname, '..', '..', 'uploads');
const cacheDir = path.join(uploadDir, '.cache');
if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

// Hanya gambar raster yang dikonversi. PDF/DOC/SVG dibiarkan diserve apa adanya.
const OPTIMIZABLE = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MAX_WIDTH = 1920;       // batas atas dimensi yang dilayani
const DEFAULT_QUALITY = 80;

/**
 * Middleware on-the-fly untuk /uploads.
 *
 * Saat browser meminta sebuah gambar (mis. GET /uploads/123.png) dan mendukung
 * WebP (hampir semua browser modern), middleware ini menyajikan versi WebP yang
 * sudah dikompres — dan opsional di-resize lewat query `?w=<lebar>`. Hasilnya
 * di-cache ke disk (uploads/.cache) sehingga konversi hanya terjadi sekali per
 * (file + ukuran). Berlaku untuk gambar lama maupun baru, tanpa mengubah path di
 * database. Permintaan non-gambar / klien tanpa dukungan WebP diteruskan ke
 * express.static (file asli).
 */
module.exports = async function imageOptimizer(req, res, next) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    // Range request (mis. video) — biar static yang tangani.
    if (req.headers.range) return next();

    const accept = req.headers.accept || '';
    if (!accept.includes('image/webp') && accept !== '*/*') return next();

    // req.path sudah relatif terhadap mount '/uploads'. Decode + amankan dari traversal.
    let rel;
    try { rel = decodeURIComponent(req.path); } catch { return next(); }
    rel = rel.replace(/^\/+/, '');
    if (!rel || rel.includes('\0')) return next();

    const ext = path.extname(rel).toLowerCase();
    if (!OPTIMIZABLE.has(ext)) return next();

    const srcPath = path.join(uploadDir, rel);
    // Pastikan tetap di dalam uploadDir dan bukan folder cache.
    const resolved = path.resolve(srcPath);
    if (!resolved.startsWith(path.resolve(uploadDir) + path.sep)) return next();
    if (resolved.startsWith(path.resolve(cacheDir))) return next();

    let stat;
    try { stat = fs.statSync(resolved); } catch { return next(); } // tidak ada → static akan 404
    if (!stat.isFile()) return next();

    // Lebar target (opsional). Clamp ke [1, MAX_WIDTH].
    let width = parseInt(req.query.w, 10);
    if (!Number.isFinite(width) || width <= 0) width = null;
    if (width) width = Math.min(width, MAX_WIDTH);

    // Kunci cache berdasarkan path + mtime + ukuran sumber + lebar target.
    const keyRaw = `${rel}|${stat.mtimeMs}|${stat.size}|w${width || 'orig'}`;
    const key = crypto.createHash('sha1').update(keyRaw).digest('hex');
    const cachePath = path.join(cacheDir, `${key}.webp`);

    const serve = () => {
      // dotfiles:'allow' karena cache ada di folder .cache (diawali titik).
      // sendFile juga menangani HEAD & Content-Type (.webp) secara otomatis.
      return res.sendFile(cachePath, {
        dotfiles: 'allow',
        maxAge: '1y',
        immutable: true,
      }, (err) => { if (err) next(err); });
    };

    if (fs.existsSync(cachePath)) return serve();

    let pipeline = sharp(resolved, { failOn: 'none' }).rotate(); // rotate() hormati EXIF orientation
    if (width) pipeline = pipeline.resize({ width, withoutEnlargement: true });
    await pipeline.webp({ quality: DEFAULT_QUALITY }).toFile(cachePath);

    return serve();
  } catch (err) {
    // Apapun yang gagal (file korup, dll) → fallback ke file asli via static.
    console.error('[imageOptimizer]', req.path, err.message);
    return next();
  }
};
