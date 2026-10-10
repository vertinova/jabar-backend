/**
 * Halaman berbagi (share) arena voting, disalin dari Simpaskor
 * (backend/src/routes/share.ts).
 *
 * KENAPA DI BACKEND, BUKAN DI REACT. Perayap tautan WhatsApp/Facebook/
 * Telegram/X tidak menjalankan JavaScript — mereka membaca tag Open Graph dari
 * HTML mentah. Situs ini SPA, jadi tautan ke /vote apa pun selalu tampil
 * dengan pratinjau yang sama. Tautan yang dibagikan karena itu mengarah ke
 * sini (/s/...): server membalas HTML kecil berisi tag OG yang benar, lalu
 * peramban manusia langsung dialihkan ke arena voting.
 *
 *   GET /api/s/vote/:nomineeId         halaman berbagi satu nominee
 *   GET /api/s/vote/:nomineeId/og      kartu pratinjau 1200x630 (JPEG)
 *   GET /api/s/vote/:nomineeId/story   kartu 1080x1920 untuk Story IG / Status WA
 *   GET /api/s/arena/:eventId          halaman berbagi satu arena
 *   GET /api/s/arena/:eventId/og       kartu pratinjau arena (dari poster)
 *
 * Kenapa di bawah /api dan tanpa akhiran .jpg: deploy berjalan lewat webhook
 * dan tidak menyentuh konfigurasi nginx. Blok `/api/` yang sudah ada sudah
 * meneruskan ke backend, sedangkan aturan regex nginx untuk berkas .jpg akan
 * merebut alamat berakhiran .jpg dan mencarinya di folder statis frontend.
 * Jenis gambarnya cukup dinyatakan lewat Content-Type.
 */
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const sharp = require('sharp');
const QRCode = require('qrcode');
const router = require('express').Router();
const prisma = require('../lib/prisma');

const UPLOADS_DIR = path.resolve(__dirname, '..', '..', 'uploads');
const OG_CACHE_DIR = path.join(UPLOADS_DIR, 'og-cache');
const REMOTE_CACHE_DIR = path.join(OG_CACHE_DIR, 'sumber');

// 1200x630 (1.91:1): rasio pratinjau besar Facebook, WhatsApp, dan Telegram.
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const STORY_WIDTH = 1080;
const STORY_HEIGHT = 1920;

const NAMA_SITUS = 'FORBASI Jawa Barat';
const LOGO_SITUS = '/LOGO-FORBASI.png';
// Rantai font disebut eksplisit: server Linux polos sering tanpa font, dan
// tanpa satu pun yang cocok seluruh teks kartu hilang tanpa pesan galat.
// Liberation Sans dibawa aplikasi sendiri (lib/fontKartu.js); sisanya cadangan.
const CARD_FONT = 'Liberation Sans, Noto Sans, DejaVu Sans, Arial, sans-serif';

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const normalizeOrigin = (value) => {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withProtocol.replace(/\/+$/, '');
};

const getPublicSiteUrl = (req) => {
  const configured = process.env.PUBLIC_SITE_URL || process.env.FRONTEND_URL;
  if (configured) return normalizeOrigin(configured);
  const host = req.get('x-forwarded-host') || req.get('host') || 'jabar.forbasi.or.id';
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
  return normalizeOrigin(`${protocol}://${host}`);
};

const toId = (value) => {
  const id = Number.parseInt(value, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
};

/* Lintasan publik ("/uploads/x.jpg") → berkas nyata. null untuk berkas yang
   tidak ada dan — terpenting — lintasan yang mencoba keluar dari uploads. */
const resolveLocalUpload = (urlPath) => {
  if (!urlPath || !urlPath.startsWith('/uploads/')) return null;
  const absolute = path.resolve(UPLOADS_DIR, urlPath.slice('/uploads/'.length));
  if (absolute !== UPLOADS_DIR && !absolute.startsWith(UPLOADS_DIR + path.sep)) return null;
  return fs.existsSync(absolute) ? absolute : null;
};

/* Foto nominee hasil sinkron FORBASI pusat berupa URL penuh, bukan berkas
   lokal. Berbeda dari Simpaskor, foto itu diunduh sekali lalu disimpan di
   disk supaya kartu tetap bisa disusun. Dibatasi waktu dan ukuran, dan hanya
   dipakai untuk URL yang memang tersimpan di baris nominee. */
const BATAS_UNDUH_MS = 8000;
const BATAS_UKURAN = 8 * 1024 * 1024;
/* Hanya host FORBASI pusat. URL foto nominee bisa diisi bebas oleh
   penyelenggara, dan server yang mengunduh alamat apa pun sama dengan membuka
   pintu ke jaringan internalnya sendiri (SSRF). */
const HOST_FOTO_DIIZINKAN = (() => {
  try {
    const host = new URL(process.env.FORBASI_API_URL || 'https://forbasi.or.id').hostname;
    return new Set([host, host.replace(/^www\./, ''), `www.${host.replace(/^www\./, '')}`]);
  } catch {
    return new Set(['forbasi.or.id', 'www.forbasi.or.id']);
  }
})();
const bolehDiunduh = (url) => {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && HOST_FOTO_DIIZINKAN.has(u.hostname);
  } catch {
    return false;
  }
};

const resolveSumberGambar = async (foto) => {
  const lokal = resolveLocalUpload(foto);
  if (lokal) return lokal;
  if (!foto || !bolehDiunduh(foto)) return null;

  const nama = crypto.createHash('sha1').update(foto).digest('hex');
  const tujuan = path.join(REMOTE_CACHE_DIR, `${nama}.img`);
  if (fs.existsSync(tujuan)) return tujuan;

  const pembatal = new AbortController();
  const pewaktu = setTimeout(() => pembatal.abort(), BATAS_UNDUH_MS);
  try {
    // Tanpa mengikuti pengalihan: tujuan pengalihan bisa keluar dari host yang diizinkan.
    const res = await fetch(foto, { signal: pembatal.signal, redirect: 'error' });
    if (!res.ok || !String(res.headers.get('content-type') || '').startsWith('image/')) return null;
    const isi = Buffer.from(await res.arrayBuffer());
    if (!isi.length || isi.length > BATAS_UKURAN) return null;
    await sharp(isi).metadata(); // pastikan memang gambar yang bisa diolah
    await fsp.mkdir(REMOTE_CACHE_DIR, { recursive: true });
    await fsp.writeFile(tujuan, isi);
    return tujuan;
  } catch {
    return null;
  } finally {
    clearTimeout(pewaktu);
  }
};

/* Latar foto yang sama diperbesar & diburamkan, foto aslinya utuh di tengah —
   rasio foto peserta bermacam-macam, dan cara ini tidak memotong satu pun. */
const buildOgImage = async (sourcePath) => {
  const background = await sharp(sourcePath)
    .resize(OG_WIDTH, OG_HEIGHT, { fit: 'cover', position: 'attention' })
    .blur(28)
    .modulate({ brightness: 0.55 })
    .toBuffer();
  const foreground = await sharp(sourcePath)
    .resize(OG_HEIGHT - 60, OG_HEIGHT - 60, { fit: 'inside', withoutEnlargement: false })
    .toBuffer();
  return sharp(background)
    .composite([{ input: foreground, gravity: 'centre' }])
    // JPEG q82 1200x630 aman di bawah batas ukuran pratinjau WhatsApp.
    .jpeg({ quality: 82, progressive: true })
    .toBuffer();
};

/* Cache disk; kunci memuat mtime + ukuran sumber dan varian teks, jadi foto
   atau nama yang diganti otomatis menghasilkan kartu baru. */
const getCachedCard = async (kind, kunci, sourcePath, variant, build) => {
  const stat = await fsp.stat(sourcePath);
  const fingerprint = crypto
    .createHash('sha1')
    .update(`${sourcePath}:${stat.mtimeMs}:${stat.size}:${variant}`)
    .digest('hex')
    .slice(0, 16);
  const cachePath = path.join(OG_CACHE_DIR, `${kind}-${kunci}-${fingerprint}.jpg`);
  try {
    return await fsp.readFile(cachePath);
  } catch {
    // Belum ada di cache — susun sekarang.
  }
  const buffer = await build();
  try {
    await fsp.mkdir(OG_CACHE_DIR, { recursive: true });
    await fsp.writeFile(cachePath, buffer);
  } catch (error) {
    // Gagal menulis cache bukan alasan gagal menyajikan gambar.
    console.error('[share] Gagal menyimpan cache kartu:', error.message);
  }
  return buffer;
};

const clampText = (value, maxChars) => {
  const clean = String(value).replace(/\s+/g, ' ').trim();
  return clean.length <= maxChars ? clean : `${clean.slice(0, maxChars - 1).trim()}…`;
};

/* SVG tidak bisa mengecilkan huruf sendiri; 0.68em per karakter adalah
   taksiran aman huruf tebal — sengaja dilebihkan agar nama tidak terpotong. */
const fitFontSize = (text, maxWidth, maxSize, minSize) => {
  if (!text.length) return maxSize;
  const estimated = Math.floor(maxWidth / (text.length * 0.68));
  return Math.max(minSize, Math.min(maxSize, estimated));
};

const wrapTwoLines = (value, maxCharsPerLine) => {
  const clean = String(value).replace(/\s+/g, ' ').trim();
  if (clean.length <= maxCharsPerLine) return [clean];
  const words = clean.split(' ');
  const first = [];
  let length = 0;
  for (const word of words) {
    if (length && length + 1 + word.length > maxCharsPerLine) break;
    first.push(word);
    length += (length ? 1 : 0) + word.length;
  }
  if (!first.length) return [clampText(clean, maxCharsPerLine)];
  const rest = words.slice(first.length).join(' ');
  return rest ? [first.join(' '), clampText(rest, maxCharsPerLine)] : [first.join(' ')];
};

const roundedMask = (width, height, radius) => Buffer.from(
  `<svg width="${width}" height="${height}"><rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`,
);

/* Kartu Story 9:16: di Story/Status yang diunggah adalah GAMBAR, jadi kartu ini
   memuat sendiri foto, nama, event, ajakan, dan QR menuju halaman vote. */
const buildStoryImage = async ({ sourcePath, nomineeName, subtitle, categoryTitle, eventTitle, shareUrl, siteHost }) => {
  // Diburamkan di ukuran kecil lalu dibesarkan: jauh lebih ringan di VPS.
  const background = await sharp(
    await sharp(sourcePath)
      .resize(Math.round(STORY_WIDTH / 4), Math.round(STORY_HEIGHT / 4), { fit: 'cover', position: 'attention' })
      .blur(12)
      .modulate({ brightness: 0.42 })
      .toBuffer(),
  )
    .resize(STORY_WIDTH, STORY_HEIGHT, { fit: 'fill' })
    .toBuffer();

  const PHOTO_BOX_W = 880;
  const PHOTO_BOX_H = 980;
  const PHOTO_BAND_TOP = 300;
  const fitted = await sharp(sourcePath)
    .resize(PHOTO_BOX_W, PHOTO_BOX_H, { fit: 'inside', withoutEnlargement: false })
    .toBuffer();
  const fittedMeta = await sharp(fitted).metadata();
  const photoW = fittedMeta.width ?? PHOTO_BOX_W;
  const photoH = fittedMeta.height ?? PHOTO_BOX_H;
  const photo = await sharp(fitted)
    .composite([{ input: roundedMask(photoW, photoH, 40), blend: 'dest-in' }])
    .png()
    .toBuffer();
  const photoLeft = Math.round((STORY_WIDTH - photoW) / 2);
  const photoTop = PHOTO_BAND_TOP + Math.round((PHOTO_BOX_H - photoH) / 2);

  const qr = await QRCode.toBuffer(shareUrl, {
    type: 'png', width: 240, margin: 1, color: { dark: '#04101c', light: '#ffffff' },
  });

  const TEXT_MAX_WIDTH = 940;
  const nameLines = wrapTwoLines(nomineeName, 24);
  const longestLine = nameLines.reduce((a, b) => (a.length >= b.length ? a : b), '');
  const nameSize = fitFontSize(longestLine, TEXT_MAX_WIDTH, 72, 34);
  const nameLineHeight = Math.round(nameSize * 1.06);
  // Blok nama tumbuh ke ATAS supaya subjudul, tombol, dan QR tidak bergeser.
  const nameBaseline = 1400;
  const nameTop = nameBaseline - (nameLines.length - 1) * nameLineHeight;

  const subtitleSize = subtitle ? fitFontSize(subtitle, TEXT_MAX_WIDTH, 34, 22) : 34;
  const eventSize = fitFontSize(eventTitle, TEXT_MAX_WIDTH, 34, 22);
  const categorySize = fitFontSize(categoryTitle, TEXT_MAX_WIDTH, 30, 20);
  const nameSvg = nameLines
    .map((line, i) => `<text x="540" y="${nameTop + i * nameLineHeight}" class="name" text-anchor="middle">${escapeHtml(line)}</text>`)
    .join('\n  ');
  const subtitleText = subtitle ? escapeHtml(clampText(subtitle, 44)) : '';

  const overlay = Buffer.from(`<svg width="${STORY_WIDTH}" height="${STORY_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#040814" stop-opacity="0"/>
      <stop offset="45%" stop-color="#040814" stop-opacity="0.82"/>
      <stop offset="100%" stop-color="#040814" stop-opacity="0.96"/>
    </linearGradient>
    <linearGradient id="scrimTop" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#040814" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#040814" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <style>
    .ev { font-family: ${CARD_FONT}; font-size: ${eventSize}px; font-weight: 700; fill: #7dd3fc; letter-spacing: 4px; }
    .cat { font-family: ${CARD_FONT}; font-size: ${categorySize}px; font-weight: 600; fill: #e2e8f0; letter-spacing: 2px; }
    .name { font-family: ${CARD_FONT}; font-size: ${nameSize}px; font-weight: 800; fill: #ffffff; }
    .sub { font-family: ${CARD_FONT}; font-size: ${subtitleSize}px; font-weight: 500; fill: #cbd5e1; }
    .cta { font-family: ${CARD_FONT}; font-size: 36px; font-weight: 800; fill: #04101c; letter-spacing: 3px; }
    .hint { font-family: ${CARD_FONT}; font-size: 24px; font-weight: 600; fill: #cbd5e1; letter-spacing: 1px; }
    .brand { font-family: ${CARD_FONT}; font-size: 28px; font-weight: 700; fill: #7dd3fc; letter-spacing: 3px; }
  </style>
  <rect x="0" y="0" width="${STORY_WIDTH}" height="260" fill="url(#scrimTop)"/>
  <rect x="0" y="1180" width="${STORY_WIDTH}" height="${STORY_HEIGHT - 1180}" fill="url(#scrim)"/>
  <text x="540" y="150" class="ev" text-anchor="middle">${escapeHtml(clampText(eventTitle, 44))}</text>
  <text x="540" y="205" class="cat" text-anchor="middle">${escapeHtml(clampText(categoryTitle, 40))}</text>
  ${nameSvg}
  ${subtitleText ? `<text x="540" y="1455" class="sub" text-anchor="middle">${subtitleText}</text>` : ''}
  <rect x="310" y="1500" width="460" height="84" rx="42" fill="#22d3ee"/>
  <text x="540" y="1553" class="cta" text-anchor="middle">VOTE SEKARANG</text>
  <rect x="420" y="1630" width="240" height="240" rx="20" fill="#ffffff"/>
  <text x="205" y="1740" class="hint" text-anchor="middle">SCAN</text>
  <text x="205" y="1775" class="hint" text-anchor="middle">UNTUK VOTE</text>
  <text x="880" y="1740" class="brand" text-anchor="middle">FORBASI</text>
  <text x="880" y="1775" class="hint" text-anchor="middle">${escapeHtml(clampText(siteHost, 22))}</text>
</svg>`);

  return sharp(background)
    .composite([
      { input: photo, left: photoLeft, top: photoTop },
      { input: overlay, left: 0, top: 0 },
      { input: qr, left: 420, top: 1630 },
    ])
    .jpeg({ quality: 88, progressive: true })
    .toBuffer();
};

const ARENA_PUBLIK = { enabled: true, approvalStatus: 'APPROVED' };

const findShareNominee = async (nomineeId) => {
  const id = toId(nomineeId);
  if (!id) return null;
  const nominee = await prisma.votingNominee.findUnique({
    where: { id },
    select: {
      id: true,
      nomineeName: true,
      nomineePhoto: true,
      nomineeSubtitle: true,
      isActive: true,
      category: {
        select: {
          id: true,
          title: true,
          isActive: true,
          config: {
            select: {
              enabled: true,
              approvalStatus: true,
              event: { select: { id: true, namaEvent: true, status: true } },
            },
          },
        },
      },
    },
  });
  const cfg = nominee?.category?.config;
  if (!nominee || !nominee.isActive || !nominee.category.isActive || !cfg) return null;
  if (cfg.approvalStatus !== 'APPROVED' || cfg.event.status === 'DITOLAK') return null;
  return {
    id: nominee.id,
    nomineeName: nominee.nomineeName,
    // Poster event sengaja tidak dipakai sebagai cadangan: kartu yang
    // menampilkan pamflet alih-alih pesertanya justru menyesatkan.
    photo: nominee.nomineePhoto,
    nomineeSubtitle: nominee.nomineeSubtitle,
    categoryTitle: nominee.category.title,
    categoryId: nominee.category.id,
    eventTitle: cfg.event.namaEvent,
    eventId: cfg.event.id,
    votingEnabled: cfg.enabled,
  };
};

/* HTML pratinjau: perayap hanya butuh <head>, manusia hanya melihatnya
   sepersekian detik sebelum dialihkan. */
const renderSharePage = ({ title, description, imageUrl, canonicalUrl, targetUrl, nonce }) => {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const img = escapeHtml(imageUrl);
  const canonical = escapeHtml(canonicalUrl);
  // Dipakai di dalam <script>, jadi harus aman sebagai literal JSON.
  const targetJson = JSON.stringify(targetUrl).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${t}</title>
<link rel="canonical" href="${canonical}" />
<meta name="description" content="${d}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${escapeHtml(NAMA_SITUS)}" />
<meta property="og:title" content="${t}" />
<meta property="og:description" content="${d}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${img}" />
<meta property="og:image:secure_url" content="${img}" />
<meta property="og:image:type" content="image/jpeg" />
<meta property="og:image:width" content="${OG_WIDTH}" />
<meta property="og:image:height" content="${OG_HEIGHT}" />
<meta property="og:image:alt" content="${t}" />
<meta property="og:locale" content="id_ID" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${t}" />
<meta name="twitter:description" content="${d}" />
<meta name="twitter:image" content="${img}" />
<style nonce="${nonce}">
html,body{height:100%;margin:0;background:#050817;color:#e2e8f0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center}
img{width:132px;height:132px;object-fit:cover;border-radius:18px}
a{color:#67e8f9}
</style>
</head>
<body>
<div class="wrap">
<img src="${img}" alt="${t}" />
<p>Membuka halaman voting…</p>
<p><a href="${canonical}" id="fallback">Klik di sini kalau tidak berpindah otomatis</a></p>
</div>
<script nonce="${nonce}">
(function () {
  var target = ${targetJson};
  document.getElementById("fallback").setAttribute("href", target);
  location.replace(target);
})();
</script>
</body>
</html>`;
};

/* CSP khusus halaman ini: nonce membatasi pelonggaran pada satu blok skrip
   pengalih yang kita tulis sendiri. */
const kirimHalaman = (res, isi) => {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.setHeader('Content-Security-Policy', [
    "default-src 'none'",
    "img-src 'self' data: https:",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join('; '));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.send(renderSharePage({ ...isi, nonce }));
};

const kirimJpeg = (res, buffer, namaBerkas) => {
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Cache-Control', 'public, max-age=604800');
  if (namaBerkas) res.setHeader('Content-Disposition', `inline; filename="${namaBerkas}"`);
  return res.end(buffer);
};

router.get('/vote/:nomineeId/og', async (req, res) => {
  try {
    const nominee = await findShareNominee(req.params.nomineeId);
    const sourcePath = nominee ? await resolveSumberGambar(nominee.photo) : null;
    // 404 lebih jujur daripada gambar kosong yang terlanjur di-cache perayap.
    if (!nominee || !sourcePath) return res.status(404).end();
    const buffer = await getCachedCard('og', nominee.id, sourcePath, 'v1', () => buildOgImage(sourcePath));
    return kirimJpeg(res, buffer);
  } catch (error) {
    console.error('[share] Gagal menyusun OG image:', error.message);
    return res.status(500).end();
  }
});

router.get('/vote/:nomineeId/story', async (req, res) => {
  try {
    const nominee = await findShareNominee(req.params.nomineeId);
    const sourcePath = nominee ? await resolveSumberGambar(nominee.photo) : null;
    if (!nominee || !sourcePath) return res.status(404).end();

    const siteUrl = getPublicSiteUrl(req);
    const shareUrl = `${siteUrl}/api/s/vote/${nominee.id}`;
    const siteHost = siteUrl.replace(/^https?:\/\//, '');
    // Teks ikut kunci cache: nama yang disunting panitia menghasilkan kartu baru.
    const variant = crypto
      .createHash('sha1')
      .update([nominee.nomineeName, nominee.nomineeSubtitle ?? '', nominee.categoryTitle, nominee.eventTitle, shareUrl].join('|'))
      .digest('hex')
      .slice(0, 12);
    const buffer = await getCachedCard('story', nominee.id, sourcePath, variant, () => buildStoryImage({
      sourcePath,
      nomineeName: nominee.nomineeName,
      subtitle: nominee.nomineeSubtitle,
      categoryTitle: nominee.categoryTitle,
      eventTitle: nominee.eventTitle,
      shareUrl,
      siteHost,
    }));
    return kirimJpeg(res, buffer, `vote-${nominee.id}.jpg`);
  } catch (error) {
    console.error('[share] Gagal menyusun kartu story:', error.message);
    return res.status(500).end();
  }
});

router.get('/vote/:nomineeId', async (req, res) => {
  const siteUrl = getPublicSiteUrl(req);
  try {
    const nominee = await findShareNominee(req.params.nomineeId);
    // Nominee dinonaktifkan/hilang: antarkan saja ke daftar voting.
    if (!nominee) return res.redirect(302, `${siteUrl}/vote`);

    const targetUrl = `${siteUrl}/vote?event=${nominee.eventId}&kategori=${nominee.categoryId}&nominee=${nominee.id}`;
    const adaFoto = await resolveSumberGambar(nominee.photo);
    const imageUrl = adaFoto ? `${siteUrl}/api/s/vote/${nominee.id}/og` : `${siteUrl}${LOGO_SITUS}`;
    const subtitle = nominee.nomineeSubtitle ? ` (${nominee.nomineeSubtitle})` : '';
    const description = nominee.votingEnabled
      ? `Dukung ${nominee.nomineeName}${subtitle} di ${nominee.categoryTitle} — ${nominee.eventTitle}. Klik untuk vote sekarang.`
      : `${nominee.nomineeName}${subtitle} di ${nominee.categoryTitle} — ${nominee.eventTitle}.`;

    return kirimHalaman(res, {
      title: `Vote ${nominee.nomineeName} — ${nominee.eventTitle}`,
      description,
      imageUrl,
      canonicalUrl: `${siteUrl}/api/s/vote/${nominee.id}`,
      targetUrl,
    });
  } catch (error) {
    console.error('[share] Gagal menyajikan halaman berbagi:', error.message);
    return res.redirect(302, `${siteUrl}/vote`);
  }
});

/* Berbagi ARENA — satu event voting. Di sini poster event justru gambar yang
   benar: yang dibagikan memang acaranya. */
const findShareArena = async (eventId) => {
  const id = toId(eventId);
  if (!id) return null;
  const event = await prisma.rekomendasiEvent.findFirst({
    where: { id, NOT: { status: 'DITOLAK' }, votingConfig: { is: ARENA_PUBLIK } },
    select: {
      id: true,
      namaEvent: true,
      poster: true,
      votingConfig: {
        select: {
          isPaid: true,
          pricePerVote: true,
          categories: { where: { isActive: true }, select: { _count: { select: { nominees: true } } } },
        },
      },
    },
  });
  if (!event) return null;
  return {
    id: event.id,
    judul: event.namaEvent,
    poster: event.poster,
    berbayar: event.votingConfig.isPaid,
    hargaPerVote: Number(event.votingConfig.pricePerVote) || 0,
    jumlahNominee: event.votingConfig.categories.reduce((n, c) => n + c._count.nominees, 0),
  };
};

router.get('/arena/:eventId/og', async (req, res) => {
  try {
    const arena = await findShareArena(req.params.eventId);
    const sourcePath = resolveLocalUpload(arena?.poster);
    if (!arena || !sourcePath) return res.status(404).end();
    const buffer = await getCachedCard('og', `arena-${arena.id}`, sourcePath, 'v1', () => buildOgImage(sourcePath));
    return kirimJpeg(res, buffer);
  } catch (error) {
    console.error('[share] Gagal menyusun OG image arena:', error.message);
    return res.status(500).end();
  }
});

router.get('/arena/:eventId', async (req, res) => {
  const siteUrl = getPublicSiteUrl(req);
  try {
    const arena = await findShareArena(req.params.eventId);
    if (!arena) return res.redirect(302, `${siteUrl}/vote`);

    const imageUrl = resolveLocalUpload(arena.poster)
      ? `${siteUrl}/api/s/arena/${arena.id}/og`
      : `${siteUrl}${LOGO_SITUS}`;
    const harga = arena.berbayar && arena.hargaPerVote > 0
      ? ` Vote mulai Rp ${Math.round(arena.hargaPerVote).toLocaleString('id-ID')}.`
      : '';
    const peserta = arena.jumlahNominee > 0 ? ` ${arena.jumlahNominee} kontestan sudah bertanding.` : '';

    return kirimHalaman(res, {
      title: `Vote ${arena.judul} — ${NAMA_SITUS}`,
      description: `Dukung jagoanmu di ${arena.judul}.${peserta}${harga} Klik untuk masuk ke arena votingnya.`,
      imageUrl,
      canonicalUrl: `${siteUrl}/api/s/arena/${arena.id}`,
      targetUrl: `${siteUrl}/vote?event=${arena.id}`,
    });
  } catch (error) {
    console.error('[share] Gagal menyajikan halaman berbagi arena:', error.message);
    return res.redirect(302, `${siteUrl}/vote`);
  }
});

module.exports = router;
