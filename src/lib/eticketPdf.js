// E-ticket dalam bentuk PDF — diporting dari Simpaskor (lib/eticketPdf.ts).
//
// Email yang menempelkan QR satu per satu masih terbaca untuk tiga tiket; untuk
// rombongan loket (sampai 50 tiket) ia menjadi surat sepanjang layar penuh
// gambar, dan penyedia email memotongnya di tengah ("[Message clipped]") —
// persis pada bagian yang berisi tiket. PDF memindahkan seluruh isi itu ke satu
// lampiran yang bisa disimpan, dicetak, dan dibuka di gerbang tanpa sinyal.
//
// Dua tiket per halaman A4, masing-masing satu kupon utuh: memisah tiket
// antar-halaman membuat petugas menggulung mencari nama, sementara memampatkan
// empat per halaman memperkecil QR sampai pemindai kesulitan.
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const sharp = require('sharp');

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 34;

const ACCENT = '#d97706';
const ACCENT_DARK = '#92400e';
const INK = '#111827';
const MUTED = '#6b7280';
const FAINT = '#9ca3af';
const LINE = '#e5e7eb';

const uploadDir = path.resolve(__dirname, '..', '..', 'uploads');

// Font bawaan PDFKit (Helvetica) hanya mengenal WinAnsi. Judul event yang memuat
// emoji melempar galat di tengah penulisan dokumen, sesudah sebagian halaman
// terlanjur jadi. Lebih baik satu karakter hilang daripada lampiran gagal.
// Tanda pisah, kutip miring, dan elipsis ADA di WinAnsi, jadi tidak dibuang.
const ALLOWED = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const NON_WINANSI = new RegExp(`[^\\x20-\\x7E\\xA0-\\xFF\\n${ALLOWED}]`, 'g');
const clean = (text) => String(text ?? '')
  .replace(NON_WINANSI, '')
  .replace(/[ \t]{2,}/g, ' ')
  .trim();

const formatDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta',
  });
};

const formatRupiah = (value) => (Number(value) === 0
  ? 'GRATIS'
  : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0));

// QR sebagai PNG buffer, bukan data URL: PDFKit menerima buffer apa adanya.
const qrBuffer = (text) => QRCode.toBuffer(text, { width: 400, margin: 1, errorCorrectionLevel: 'H', type: 'png' });

// Poster dipotong "cover" ke ukuran tepat yang dipakai lalu dijadikan JPEG:
// PDFKit tidak mengenal WebP, dan poster jutaan piksel yang ditanam apa adanya
// ke tiap kupon membuat berkas membengkak. Gagal apa pun → null, dan kupon turun
// anggun ke pita berwarna. Tiket tanpa poster masih tiket.
const prepareBanner = async (posterPath, width, height) => {
  if (!posterPath || typeof posterPath !== 'string' || !posterPath.startsWith('/uploads/')) return null;
  const fullPath = path.resolve(uploadDir, path.basename(posterPath));
  if (!fullPath.startsWith(uploadDir)) return null;
  try {
    const raw = await fs.promises.readFile(fullPath);
    return await sharp(raw, { failOn: 'none' })
      .rotate()
      .resize(Math.round(width * 2), Math.round(height * 2), { fit: 'cover', position: 'attention' })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    return null;
  }
};

const drawBanner = (doc, image, x, y, width, height) => {
  if (image) {
    doc.image(image, x, y, { width, height });
    // Lapisan gelap dari bawah: judul putih tetap terbaca di atas poster apa pun.
    const shade = doc.linearGradient(x, y, x, y + height);
    shade.stop(0, '#000000', 0.15).stop(0.45, '#000000', 0.45).stop(1, '#000000', 0.82);
    doc.rect(x, y, width, height).fill(shade);
  } else {
    const band = doc.linearGradient(x, y, x + width, y + height);
    band.stop(0, ACCENT).stop(1, ACCENT_DARK);
    doc.rect(x, y, width, height).fill(band);
  }
};

const drawPill = (doc, text, x, y, { background, color, size = 8 }) => {
  doc.font('Helvetica-Bold').fontSize(size);
  const textWidth = doc.widthOfString(text);
  const height = size + 9;
  doc.roundedRect(x, y, textWidth + 14, height, height / 2).fill(background);
  doc.fillColor(color).text(text, x + 7, y + (height - size) / 2 + 0.5, { width: textWidth + 1, lineBreak: false });
};

// Kupon satu tiket: kepala berposter, badan berisi satu nama besar, lalu sobekan
// bergigi yang memisahkan bonggol QR di kanan.
const drawTicket = (doc, data, ticket, number, total, qr, banner, top) => {
  const x = MARGIN;
  const width = A4_WIDTH - MARGIN * 2;
  const height = (A4_HEIGHT - MARGIN * 2 - 22) / 2;
  const radius = 14;
  const headHeight = 92;
  const stubWidth = 168;
  const tearX = x + width - stubWidth;

  // Bayangan palsu: PDFKit tidak punya bayangan. Kepekatan lewat fillOpacity,
  // karena PDFKit tidak mengenal hex berkanal alfa.
  doc.fillOpacity(0.05).roundedRect(x + 2, top + 2.5, width, height, radius).fill('#000000');
  doc.fillOpacity(1);

  doc.save();
  doc.roundedRect(x, top, width, height, radius).clip();
  doc.rect(x, top, width, height).fill('#ffffff');

  drawBanner(doc, banner, x, top, width, headHeight);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(15)
    .text(clean(data.eventTitle), x + 18, top + headHeight - 40, { width: width - 130, height: 34, ellipsis: true, lineGap: -1 });
  doc.fillColor('#ffffff', 0.82).font('Helvetica-Bold').fontSize(7.5)
    .text('TIKET MASUK · E-TICKET', x + 18, top + 18, { characterSpacing: 1.4, lineBreak: false });

  const label = `${String(number).padStart(2, '0')} / ${total}`;
  doc.font('Helvetica-Bold').fontSize(9);
  const pillWidth = doc.widthOfString(label) + 18;
  doc.fillOpacity(0.22).roundedRect(x + width - pillWidth - 18, top + 14, pillWidth, 20, 10).fill('#ffffff');
  doc.fillOpacity(1);
  doc.fillColor('#ffffff').text(label, x + width - pillWidth - 18, top + 20, { width: pillWidth, align: 'center' });

  // Badan kiri: nama penonton dan keterangan.
  const column = tearX - x - 36;
  let y = top + headHeight + 18;
  doc.fillColor(FAINT).font('Helvetica-Bold').fontSize(7).text('NAMA PENONTON', x + 18, y, { characterSpacing: 1.2, lineBreak: false });
  y += 12;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(21)
    .text(clean(ticket.name), x + 18, y, { width: column, height: 26, ellipsis: true, lineBreak: false });
  y += 38;
  doc.moveTo(x + 18, y).lineTo(tearX - 22, y).lineWidth(0.8).stroke(LINE);
  y += 20;

  const details = [
    // Kupon inilah yang ditunjukkan di gerbang: tiket Hari 2 harus menyebut
    // Hari 2, bukan tanggal pembukaan acara.
    ['DAPAT DIGUNAKAN', data.validity || formatDate(data.eventDate)],
    ['LOKASI', data.venue || '-'],
    ['JENIS TIKET', data.ticketTypeName || 'Tiket Masuk'],
    ['PEMBELI', data.buyerName],
  ];
  const cellWidth = (column - 14) / 2;
  details.forEach(([key, value], index) => {
    const cx = x + 18 + (index % 2) * (cellWidth + 14);
    const cy = y + Math.floor(index / 2) * 40;
    doc.fillColor(FAINT).font('Helvetica-Bold').fontSize(6.5).text(key, cx, cy, { characterSpacing: 1, lineBreak: false });
    doc.fillColor('#374151').font('Helvetica-Bold').fontSize(10.5)
      .text(clean(value), cx, cy + 9, { width: cellWidth, height: 14, ellipsis: true, lineBreak: false });
  });

  const tipY = top + height - 58;
  doc.roundedRect(x + 18, tipY, column, 36, 8).fill('#f9fafb');
  doc.rect(x + 18, tipY, 3, 36).fill(ACCENT);
  doc.fillColor('#4b5563').font('Helvetica-Bold').fontSize(8)
    .text('Tunjukkan QR di sebelah kanan kepada petugas pintu masuk.', x + 30, tipY + 10, { width: column - 24, ellipsis: true, lineBreak: false });
  doc.fillColor(FAINT).font('Helvetica').fontSize(7)
    .text('Satu QR berlaku untuk satu orang dan hanya bisa dipindai sekali.', x + 30, tipY + 22, { width: column - 24, ellipsis: true, lineBreak: false });

  doc.fillColor(FAINT).font('Helvetica').fontSize(7)
    .text(`Pesanan ${data.orderCode}`, x + 18, top + height - 16, { width: column, ellipsis: true, lineBreak: false });

  // Bonggol kanan: yang dipindai.
  doc.rect(tearX, top + headHeight, stubWidth, height - headHeight).fill('#fffbeb');
  const qrSize = 128;
  const qrX = tearX + (stubWidth - qrSize) / 2;
  const qrY = top + headHeight + 30;
  doc.roundedRect(qrX - 9, qrY - 9, qrSize + 18, qrSize + 18, 10).fill('#ffffff');
  doc.image(qr, qrX, qrY, { width: qrSize, height: qrSize });
  doc.fillColor(INK).font('Courier-Bold').fontSize(9.5)
    .text(ticket.ticketCode, tearX, qrY + qrSize + 18, { width: stubWidth, align: 'center' });

  const badge = 'BERLAKU 1 ORANG';
  doc.font('Helvetica-Bold').fontSize(6.5);
  const badgeWidth = doc.widthOfString(badge) + 14;
  drawPill(doc, badge, tearX + (stubWidth - badgeWidth) / 2, top + height - 32, { background: '#fef3c7', color: ACCENT_DARK, size: 6.5 });

  doc.restore();

  // Sobekan: digambar sesudah guntingan dilepas supaya takiknya menimpa tepi.
  doc.save();
  doc.dash(3, { space: 3.5 });
  doc.moveTo(tearX, top + 9).lineTo(tearX, top + headHeight).lineWidth(1).strokeOpacity(0.55).stroke('#ffffff');
  doc.restore();
  doc.moveTo(tearX, top + headHeight).lineTo(tearX, top + height - 9).lineWidth(1).dash(3, { space: 3.5 }).stroke('#f3d9a4').undash();
  [top, top + height].forEach((notchY) => {
    doc.circle(tearX, notchY, 9).fill('#ffffff');
    doc.circle(tearX, notchY, 9).lineWidth(0.8).stroke(LINE);
  });
  doc.roundedRect(x, top, width, height, radius).lineWidth(1).stroke(LINE);
};

// Halaman sampul: pesanan milik siapa, isinya apa, tiketnya di halaman berapa.
const drawCover = (doc, data, banner) => {
  const bannerHeight = 250;
  drawBanner(doc, banner, 0, 0, A4_WIDTH, bannerHeight);

  doc.roundedRect(MARGIN, 34, 78, 22, 11).fill(ACCENT);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8)
    .text('E-TICKET', MARGIN, 41, { width: 78, align: 'center', characterSpacing: 1.2 });
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(27)
    .text(clean(data.eventTitle), MARGIN, bannerHeight - 96, { width: A4_WIDTH - MARGIN * 2, height: 68, ellipsis: true, lineGap: -3 });
  doc.fillColor('#ffffff', 0.88).font('Helvetica').fontSize(10.5)
    .text(`${formatDate(data.eventDate)}  ·  ${data.venue || '-'}`, MARGIN, bannerHeight - 26, { width: A4_WIDTH - MARGIN * 2, ellipsis: true, lineBreak: false });

  let y = bannerHeight + 26;
  const boxWidth = (A4_WIDTH - MARGIN * 2 - 12) / 2;
  const summary = [
    ['PEMESAN', data.buyerName],
    ['KODE PESANAN', data.orderCode],
    ['JUMLAH TIKET', `${data.tickets.length} tiket`],
    ['TOTAL', formatRupiah(data.totalAmount)],
    ['JENIS TIKET', data.ticketTypeName || 'Tiket Masuk'],
  ];
  if (data.validity) summary.push(['DAPAT DIGUNAKAN', data.validity]);
  summary.forEach(([key, value], index) => {
    const bx = MARGIN + (index % 2) * (boxWidth + 12);
    const by = y + Math.floor(index / 2) * 60;
    doc.roundedRect(bx, by, boxWidth, 50, 10).fill('#f9fafb');
    doc.fillColor(FAINT).font('Helvetica-Bold').fontSize(6.5).text(key, bx + 14, by + 12, { characterSpacing: 1, lineBreak: false });
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(13)
      .text(clean(value), bx + 14, by + 24, { width: boxWidth - 28, height: 17, ellipsis: true, lineBreak: false });
  });
  y += Math.ceil(summary.length / 2) * 60 + 12;

  if (data.description) {
    doc.fillColor('#374151').font('Helvetica').fontSize(9.5).text(clean(data.description), MARGIN, y, { width: A4_WIDTH - MARGIN * 2 });
    y = doc.y + 14;
  }

  const note = 'Setiap tiket berlaku untuk satu orang dan hanya bisa dipindai sekali. Bawa berkas ini — '
    + 'tercetak atau di layar — lalu tunjukkan QR masing-masing penonton di pintu masuk.';
  doc.font('Helvetica-Bold').fontSize(9);
  const noteHeight = doc.heightOfString(note, { width: A4_WIDTH - MARGIN * 2 - 34 }) + 26;
  doc.roundedRect(MARGIN, y, A4_WIDTH - MARGIN * 2, noteHeight, 10).fill('#fff7ed');
  doc.rect(MARGIN, y, 3.5, noteHeight).fill('#f59e0b');
  doc.fillColor('#92400e').text(note, MARGIN + 18, y + 13, { width: A4_WIDTH - MARGIN * 2 - 34 });
  y += noteHeight + 22;

  doc.fillColor(FAINT).font('Helvetica').fontSize(9)
    .text(`Tiket dimulai di halaman 2, dua tiket per halaman. Daftar lengkap ${data.tickets.length} penonton ada di halaman terakhir.`, MARGIN, y, { width: A4_WIDTH - MARGIN * 2 });
};

// Indeks penonton di BELAKANG seluruh kupon: di sampul, daftar panjang tumpah ke
// halaman dua dan menggeser kupon, sementara nomor halamannya terlanjur dihitung.
const drawAttendeeList = (doc, data) => {
  doc.addPage();
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text('Daftar penonton', MARGIN, MARGIN);
  doc.fillColor(FAINT).font('Helvetica').fontSize(8.5).text(`Pesanan ${data.orderCode} · ${data.tickets.length} tiket`, MARGIN, doc.y + 2);
  let y = doc.y + 12;
  data.tickets.forEach((ticket, index) => {
    if (y > A4_HEIGHT - MARGIN - 20) {
      doc.addPage();
      y = MARGIN;
    }
    if (index % 2 === 0) doc.rect(MARGIN, y - 3, A4_WIDTH - MARGIN * 2, 17).fill('#f9fafb');
    doc.fillColor(FAINT).font('Helvetica').fontSize(8.5).text(`${index + 1}.`, MARGIN + 8, y, { width: 22, lineBreak: false });
    doc.fillColor('#374151').font('Helvetica-Bold').fontSize(9).text(clean(ticket.name), MARGIN + 30, y, { width: 230, ellipsis: true, lineBreak: false });
    doc.fillColor(MUTED).font('Courier').fontSize(8.5).text(ticket.ticketCode, MARGIN + 268, y, { width: 150, lineBreak: false });
    doc.fillColor(FAINT).font('Helvetica').fontSize(8.5)
      .text(`hal. ${2 + Math.floor(index / 2)}`, A4_WIDTH - MARGIN - 60, y, { width: 52, align: 'right', lineBreak: false });
    y += 17;
  });
};

/**
 * Susun seluruh tiket satu pesanan jadi satu PDF (Buffer).
 * data: { eventTitle, eventDate, venue, buyerName, orderCode, totalAmount,
 *         ticketTypeName, validity, description, posterPath, tickets: [{ name, ticketCode }] }
 */
const buildTicketPdf = async (data) => {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    autoFirstPage: false,
    info: {
      Title: `E-Ticket ${clean(data.eventTitle)}`,
      Author: 'FORBASI Jawa Barat',
      Subject: `Pesanan ${data.orderCode} — ${data.tickets.length} tiket`,
    },
  });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // Poster disiapkan SEKALI per ukuran; buffer identik disimpan PDFKit satu kali
  // saja di berkas, jadi lima puluh kupon bukan lima puluh salinan gambar.
  const [coverBanner, ticketBanner] = await Promise.all([
    prepareBanner(data.posterPath, A4_WIDTH, 250),
    prepareBanner(data.posterPath, A4_WIDTH - MARGIN * 2, 92),
  ]);

  doc.addPage();
  drawCover(doc, data, coverBanner);

  // QR dibuat berurutan, bukan Promise.all, supaya pesanan besar tidak menahan
  // puluhan buffer gambar di memori bersamaan.
  for (let index = 0; index < data.tickets.length; index += 1) {
    if (index % 2 === 0) doc.addPage();
    const top = index % 2 === 0 ? MARGIN : MARGIN + (A4_HEIGHT - MARGIN * 2 - 22) / 2 + 22;
    // eslint-disable-next-line no-await-in-loop
    const qr = await qrBuffer(data.tickets[index].ticketCode);
    drawTicket(doc, data, data.tickets[index], index + 1, data.tickets.length, qr, ticketBanner, top);
  }

  drawAttendeeList(doc, data);
  doc.end();
  return done;
};

const ticketPdfFilename = (orderCode) => `eticket-${orderCode}.pdf`;

module.exports = { buildTicketPdf, ticketPdfFilename };
