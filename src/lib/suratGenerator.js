const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const prisma = require('./prisma');

const uploadDir = path.join(__dirname, '..', '..', 'uploads');
const suratDir = path.join(uploadDir, 'surat');

// Ensure surat directory exists
if (!fs.existsSync(suratDir)) {
  fs.mkdirSync(suratDir, { recursive: true });
}

function resolveAssetPath(relativePath) {
  const p = path.join(__dirname, '..', '..', relativePath.replace(/^\//, ''));
  return fs.existsSync(p) ? p : null;
}

/**
 * Generate Surat Rekomendasi PDF – matches official FORBASI template
 */
async function generateSuratRekomendasi(rekomendasiEvent) {
  // Fetch signature & stamp config (2 signers + stamp)
  const configs = await prisma.siteConfig.findMany({
    where: { key: { in: ['tanda_tangan_ketua', 'tanda_tangan_sekretaris', 'stempel'] } }
  });
  const cfgMap = {};
  configs.forEach(c => { cfgMap[c.key] = c.value; });

  const ttdKetua = cfgMap['tanda_tangan_ketua'] || {};
  const ttdSekretaris = cfgMap['tanda_tangan_sekretaris'] || {};
  const stempelCfg = cfgMap['stempel'] || {};

  const filename = `surat-rekomendasi-${rekomendasiEvent.id}-${Date.now()}.pdf`;
  const filePath = path.join(suratDir, filename);

  return new Promise((resolve, reject) => {
    try {
      const marginL = 60;
      const marginR = 60;
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: marginL, right: marginR }
      });

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      const pw = doc.page.width;   // 595.28
      const cw = pw - marginL - marginR; // content width

      // ════════════════════════════════════════════
      //  KOP SURAT – persis template resmi Pengda Jabar
      // ════════════════════════════════════════════
      // Logo pengda jabar (kop surat)
      const logoCandidates = [
        path.join(__dirname, '..', '..', 'uploads', 'logo-kopsurat.png'),
        path.join(__dirname, '..', '..', '..', 'frontend', 'public', 'logo-kopsurat.png'),
        path.join(__dirname, '..', '..', 'uploads', 'logo-pengda-jabar.png'),
        path.join(__dirname, '..', '..', '..', 'frontend', 'public', 'logo-pengda-jabar.png'),
        path.join(__dirname, '..', '..', 'uploads', 'LOGO-FORBASI.png'),
        path.join(__dirname, '..', '..', '..', 'frontend', 'public', 'LOGO-FORBASI.png'),
      ];
      const actualLogo = logoCandidates.find(p => fs.existsSync(p)) || null;

      const kopTop = 15;
      const logoW = 80;
      const logoH = 95;

      if (actualLogo) {
        doc.image(actualLogo, marginL, kopTop, { fit: [logoW, logoH] });
      }

      // Text block right next to logo – minimal gap like official template
      const textGap = 4;
      const textLeft = marginL + logoW + textGap;
      const textW = cw - logoW - textGap;

      // Green color for header text
      const greenColor = '#1a8c1a';

      // Vertical offset to center text block relative to logo
      const textTopOffset = 10;

      doc.fontSize(11).font('Helvetica-Bold').fillColor(greenColor)
        .text('PENGURUS DAERAH', textLeft, kopTop + textTopOffset, { width: textW, align: 'left' });
      doc.fontSize(15).font('Helvetica-Bold').fillColor(greenColor)
        .text('FORUM BARIS INDONESIA', textLeft, kopTop + textTopOffset + 14, { width: textW, align: 'left' });
      doc.fontSize(12).font('Helvetica-Bold').fillColor(greenColor)
        .text('PROVINSI JAWA BARAT', textLeft, kopTop + textTopOffset + 32, { width: textW, align: 'left' });

      // Address lines – green colored, right below title text
      doc.fontSize(7).font('Helvetica').fillColor(greenColor)
        .text('Alamat : Jl. Farmakologi 01 Kel.Cigadung Kec.Cibeunying Kaler Kota Bandung, Jawa Barat',
          textLeft, kopTop + textTopOffset + 50, { width: textW, align: 'left' });
      doc.fontSize(7).font('Helvetica').fillColor(greenColor)
        .text('Email : forbasijawabarat@gmail.com, IG : forbasi.jabar, Web : jabar.forbasi.or.id',
          textLeft, kopTop + textTopOffset + 60, { width: textW, align: 'left' });
      doc.fontSize(7).font('Helvetica').fillColor(greenColor)
        .text('HP : +62 822-9557-6388 (call/wa), +62 851-1951-1898 (wa)',
          textLeft, kopTop + textTopOffset + 70, { width: textW, align: 'left' });

      // Reset to black for body
      doc.fillColor('black');

      // Double line separator
      const lineY = kopTop + 110;
      doc.moveTo(marginL, lineY).lineTo(pw - marginR, lineY).lineWidth(2.5).strokeColor(greenColor).stroke();
      doc.moveTo(marginL, lineY + 3).lineTo(pw - marginR, lineY + 3).lineWidth(0.5).strokeColor(greenColor).stroke();
      // Reset stroke color
      doc.strokeColor('black');

      // ════════════════════════════════════════════
      //  TITLE
      // ════════════════════════════════════════════
      let y = lineY + 20;

      doc.fontSize(13).font('Helvetica-Bold')
        .text('REKOMENDASI', marginL, y, { width: cw, align: 'center', underline: true });
      y += 20;

      // Nomor surat – from auto-generated nomorSurat field
      const nomorSurat = `Nomor : ${rekomendasiEvent.nomorSurat || 'UM.     /FORBASI-JABAR/     /' + new Date().getFullYear()}`;
      doc.fontSize(9).font('Helvetica')
        .text(nomorSurat, marginL, y, { width: cw, align: 'center' });
      y += 28;

      // ════════════════════════════════════════════
      //  BODY TEXT
      // ════════════════════════════════════════════
      const fs10 = 10;
      const bodyIndent = marginL;
      const bodyW = cw;
      const lg = 3; // lineGap

      doc.fontSize(fs10).font('Helvetica')
        .text('Berdasarkan hasil Verifikasi Faktual Forbasi dengan ini Pengurus Daerah Forbasi Provinsi Jawa Barat memberikan ', bodyIndent, y, {
          width: bodyW, align: 'justify', lineGap: lg, continued: true
        })
        .font('Helvetica-Bold').text('rekomendasi', { continued: true })
        .font('Helvetica').text(' kepada :', { lineGap: lg });

      y = doc.y + 12;

      // ── Event detail rows ──
      const labelX = bodyIndent + 20;
      const colonX = labelX + 120;
      const valX = colonX + 10;
      const valW = bodyW - (valX - bodyIndent);

      const details = [
        ['Nama Kegiatan', rekomendasiEvent.namaEvent || '-'],
        ['Penyelenggara', rekomendasiEvent.penyelenggara || '-'],
        ['Waktu', formatDateRange(rekomendasiEvent.tanggalMulai, rekomendasiEvent.tanggalSelesai)],
        ['Tempat', rekomendasiEvent.lokasi || '-'],
      ];

      details.forEach(([label, value]) => {
        doc.fontSize(fs10).font('Helvetica').text(label, labelX, y, { width: 120 });
        doc.fontSize(fs10).font('Helvetica').text(':', colonX, y);
        doc.fontSize(fs10).font('Helvetica').text(value, valX, y, { width: valW });
        y += 18;
      });

      y += 8;

      // ════════════════════════════════════════════
      //  KETENTUAN
      // ════════════════════════════════════════════
      doc.fontSize(fs10).font('Helvetica')
        .text('Untuk melaksanakan kegiatan tersebut dengan ketentuan sebagai berikut :', bodyIndent, y, {
          width: bodyW, lineGap: lg
        });
      y = doc.y + 8;

      const numIndent = bodyIndent + 15;
      const numW = bodyW - 15;
      const subIndent = bodyIndent + 30;
      const subW = bodyW - 30;

      // Ketentuan 1
      doc.fontSize(fs10).font('Helvetica')
        .text('1.  Standar teknis penyelenggaraan harus mematuhi aturan standar Forbasi, yang meliputi:', numIndent, y, { width: numW, lineGap: lg });
      y = doc.y + 4;

      const subItems = [
        'a. Standar Administratif',
        'b. Standar Sarana dan Prasarana',
        'c. Standar Perangkat Perlombaan',
        'd. Standar Peserta',
        'e. Standar Penghargaan',
      ];
      subItems.forEach(item => {
        doc.fontSize(fs10).font('Helvetica').text(item, subIndent, y, { width: subW });
        y = doc.y + 2;
      });
      y += 4;

      // Ketentuan 2
      doc.fontSize(fs10).font('Helvetica')
        .text('2.  Berkomitmen melaksanakan fakta integritas yang telah ditandatangani oleh penyelenggara.', numIndent, y, { width: numW, lineGap: lg });
      y = doc.y + 4;

      // Ketentuan 3
      doc.fontSize(fs10).font('Helvetica')
        .text('3.  Berkoordinasi dengan Komisi Perlombaan Forbasi dari sebelum hingga pelaksanaan selesai.', numIndent, y, { width: numW, lineGap: lg });
      y = doc.y + 4;

      // Ketentuan 4
      doc.fontSize(fs10).font('Helvetica')
        .text('4.  Memberikan laporan kegiatan setelah penyelenggaraan selesai kepada Pengurus Cabang setempat dan Pengurus Daerah Forbasi Jawa Barat.', numIndent, y, { width: numW, lineGap: lg });
      y = doc.y + 20;

      // ════════════════════════════════════════════
      //  SIGNATURE BLOCK (2 columns + stamp center)
      // ════════════════════════════════════════════
      const approvalDate = rekomendasiEvent.approvedPengdaAt || new Date();
      const dateStr = new Date(approvalDate).toLocaleDateString('id-ID', {
        day: 'numeric', month: 'long', year: 'numeric'
      });

      // Check if we need a new page
      if (y > 620) { doc.addPage(); y = 60; }

      // Date centered above org name
      doc.fontSize(fs10).font('Helvetica')
        .text(`Bandung, ${dateStr}`, marginL, y, { width: cw, align: 'center' });
      y += 18;

      // Org name block (centered)
      doc.fontSize(fs10).font('Helvetica-Bold')
        .text('PENGURUS DAERAH', marginL, y, { width: cw, align: 'center' });
      y += 14;
      doc.fontSize(fs10).font('Helvetica-Bold')
        .text('FORUM BARIS INDONESIA', marginL, y, { width: cw, align: 'center' });
      y += 14;
      doc.fontSize(fs10).font('Helvetica-Bold')
        .text('PROVINSI JAWA BARAT', marginL, y, { width: cw, align: 'center' });
      y += 20;

      // Two columns for signatures
      const colW = 180;
      const ketuaX = marginL;     // left column
      const sekretarisX = pw - marginR - colW; // right column
      const signY = y;

      // Jabatan labels
      doc.fontSize(fs10).font('Helvetica')
        .text('Ketua,', ketuaX, signY, { width: colW, align: 'center' });
      doc.fontSize(fs10).font('Helvetica')
        .text('Sekretaris,', sekretarisX, signY, { width: colW, align: 'center' });

      // Signature images
      const sigImgY = signY + 16;
      const sigH = 55;

      if (ttdKetua.signaturePath) {
        const p = resolveAssetPath(ttdKetua.signaturePath);
        if (p) doc.image(p, ketuaX + 25, sigImgY, { width: 130, height: sigH });
      }
      if (ttdSekretaris.signaturePath) {
        const p = resolveAssetPath(ttdSekretaris.signaturePath);
        if (p) doc.image(p, sekretarisX + 25, sigImgY, { width: 130, height: sigH });
      }

      // Stamp in center (overlapping signatures area)
      if (stempelCfg.stampPath) {
        const p = resolveAssetPath(stempelCfg.stampPath);
        if (p) {
          const stampSize = 90;
          doc.image(p, (pw - stampSize) / 2, sigImgY - 5, { width: stampSize, height: stampSize });
        }
      }

      // Signer names (below signatures)
      const nameY = sigImgY + sigH + 8;
      doc.fontSize(fs10).font('Helvetica-Bold')
        .text(ttdKetua.signerName || '____________________', ketuaX, nameY, { width: colW, align: 'center', underline: true });
      doc.fontSize(fs10).font('Helvetica-Bold')
        .text(ttdSekretaris.signerName || '____________________', sekretarisX, nameY, { width: colW, align: 'center', underline: true });

      doc.end();

      stream.on('finish', () => resolve(`/uploads/surat/${filename}`));
      stream.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}

function formatDateRange(start, end) {
  if (!start) return '-';
  const opts = { day: 'numeric', month: 'long', year: 'numeric' };
  const startStr = new Date(start).toLocaleDateString('id-ID', opts);
  if (!end) return startStr;
  const endStr = new Date(end).toLocaleDateString('id-ID', opts);
  if (startStr === endStr) return startStr;
  return `${startStr} - ${endStr}`;
}

module.exports = { generateSuratRekomendasi };
