/**
 * Font untuk teks di kartu berbagi (share.routes.js), dibawa sendiri oleh
 * aplikasi.
 *
 * Teks kartu digambar dari SVG oleh sharp/libvips, yang mencari font lewat
 * fontconfig sistem. Server polos sering tidak punya font sama sekali, dan
 * saat itu seluruh teks kartu hilang tanpa pesan galat. Karena deploy berjalan
 * lewat webhook (tanpa memasang paket di server), fontnya ikut di repo —
 * Liberation Sans, lisensi SIL OFL — dan fontconfig diarahkan ke folder itu
 * lewat FONTCONFIG_FILE.
 *
 * Harus dimuat SEBELUM sharp menggambar teks pertama: fontconfig membaca
 * variabel ini sekali saat pertama kali dipakai. Folder font sistem tetap ikut
 * dibaca, supaya urutan pencarian huruf yang tidak ada di Liberation tetap jalan.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');

const pasangFontKartu = () => {
  if (process.env.FONTCONFIG_FILE) return; // sudah diatur dari luar
  try {
    const cacheDir = path.join(os.tmpdir(), 'forbasi-fontconfig-cache');
    const conf = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${FONT_DIR.replace(/&/g, '&amp;')}</dir>
  <dir>/usr/share/fonts</dir>
  <dir>/usr/local/share/fonts</dir>
  <cachedir>${cacheDir.replace(/&/g, '&amp;')}</cachedir>
</fontconfig>
`;
    const confPath = path.join(os.tmpdir(), 'forbasi-fonts.conf');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(confPath, conf);
    process.env.FONTCONFIG_FILE = confPath;
  } catch (error) {
    // Tanpa ini kartu tetap tersusun, hanya bergantung pada font sistem.
    console.warn('[share] Gagal memasang font kartu:', error.message);
  }
};

pasangFontKartu();

module.exports = { FONT_DIR };
