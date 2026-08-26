// E-ticket: satu email ke alamat PEMBELI berisi QR setiap penonton sebagai
// lampiran gambar — bukan satu email per penonton. Peserta yang alamatnya diisi
// tetap tidak menerima email sendiri; bila alamat pembeli salah tulis, panitia
// memakai "Kirim Ulang Email" dan mengubah alamat tujuannya.
const QRCode = require('qrcode');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { sendMail, isMailerConfigured } = require('./mailer');
const { isPlaceholderEmail } = require('./ticketing');

const uploadDir = path.join(__dirname, '..', '..', 'uploads');
const POSTER_CID = 'poster-event';

// Poster dipasang sebagai banner di kepala email, utuh apa adanya: poster acara
// memuat logo, sponsor, dan jadwal yang tersebar ke seluruh bidangnya, jadi
// dipotong jadi bentuk lebar hampir pasti memenggal sesuatu yang penting.
// Ukurannya cuma dibatasi agar lampirannya tidak membengkak.
//
// Berkasnya dilampirkan lewat Content-ID, bukan ditautkan ke URL publik: Gmail
// dan Outlook menahan gambar dari luar sampai penerima menekan "tampilkan
// gambar", dan banner yang mesti diminta dulu bukan banner.
const buildPosterAttachment = async (posterPath) => {
  if (!posterPath || typeof posterPath !== 'string') return null;
  if (!posterPath.startsWith('/uploads/')) return null;

  const fullPath = path.resolve(uploadDir, path.basename(posterPath));
  if (!fullPath.startsWith(path.resolve(uploadDir))) return null;

  try {
    await fs.promises.access(fullPath, fs.constants.R_OK);
    // failOn: 'none' supaya berkas yang sedikit cacat tetap terpakai; PDF dan
    // format yang bukan gambar akan gagal di sini dan email tetap terkirim
    // tanpa banner.
    const content = await sharp(fullPath, { failOn: 'none' })
      .rotate()
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer();
    return { filename: 'poster.jpg', content, cid: POSTER_CID };
  } catch (error) {
    console.warn('[Ticket] Poster tidak bisa dipasang di email:', error.message);
    return null;
  }
};

const formatCurrency = (value) => new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
}).format(Number(value) || 0);

const formatDateTime = (value) => (value
  ? new Date(value).toLocaleString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  : '-');

const formatDate = (value) => (value
  ? new Date(value).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
  : '-');

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// QR di-render sebagai PNG dan dilampirkan dengan Content-ID, bukan ditanam
// sebagai data URI: banyak klien email (Gmail salah satunya) memblokir gambar
// data-URI di dalam <img>, sehingga tiketnya akan tampak kosong.
const renderTicketQr = async (ticketCode) => {
  const buffer = await QRCode.toBuffer(ticketCode, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 320,
    color: { dark: '#111827', light: '#ffffff' },
  });
  return buffer;
};

const buildTicketEmailHtml = ({ event, config, order, attendees, hasPoster = false }) => {
  const eventName = escapeHtml(event?.namaEvent || 'Event');
  const location = escapeHtml(event?.lokasi || '-');
  const schedule = event?.tanggalMulai
    ? `${formatDate(event.tanggalMulai)}${event.tanggalSelesai && String(event.tanggalSelesai) !== String(event.tanggalMulai) ? ` – ${formatDate(event.tanggalSelesai)}` : ''}`
    : '-';
  const typeName = order.ticketType?.name ? escapeHtml(order.ticketType.name) : 'Tiket Masuk';
  const validDate = order.ticketType?.kind === 'DAY' && order.ticketType?.validDate
    ? `<p style="margin:8px 0 0;font-size:12px;font-weight:600;color:#b45309;">Berlaku khusus ${escapeHtml(formatDate(order.ticketType.validDate))}.</p>`
    : '';

  // Banner hanya dipasang bila lampirannya benar-benar jadi; kalau tidak, kepala
  // email tetap rapi dengan blok gelapnya saja.
  const posterBanner = hasPoster
    ? `<tr>
            <td style="padding:0;font-size:0;line-height:0;">
              <img src="cid:${POSTER_CID}" alt="${eventName}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:20px 20px 0 0;" />
            </td>
          </tr>`
    : '';

  // Sudut atas kartu gelap ikut lurus begitu ada banner di atasnya, supaya
  // keduanya menyatu jadi satu kepala dan bukan dua kotak yang bertumpuk.
  const headerRadius = hasPoster ? '0' : '20px 20px 0 0';

  const summaryCell = (label, value, sub = '') => `
                    <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#94a3b8;">${label}</p>
                    <p style="margin:5px 0 0;font-size:15px;font-weight:700;color:#0f172a;line-height:1.35;">${value}</p>
                    ${sub ? `<p style="margin:3px 0 0;font-size:12px;color:#94a3b8;">${sub}</p>` : ''}`;

  const ticketCards = attendees.map((attendee, index) => `
    <tr>
      <td style="padding:0 0 14px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #e2e8f0;border-radius:18px;background:#ffffff;">
          <tr>
            <td style="padding:18px 20px 14px;" align="center">
              <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#f59e0b;">Tiket ${index + 1} dari ${attendees.length}</p>
              <p style="margin:6px 0 0;font-size:18px;font-weight:800;color:#0f172a;line-height:1.3;">${escapeHtml(attendee.name)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 20px;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr><td style="border-top:1px dashed #cbd5e1;font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 20px 20px;" align="center">
              <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;">
                <tr><td style="padding:10px;font-size:0;line-height:0;">
                  <img src="cid:${attendee.ticketCode}" alt="QR ${escapeHtml(attendee.ticketCode)}" width="188" height="188" style="display:block;border:0;" />
                </td></tr>
              </table>
              <p style="margin:14px 0 0;font-family:'SFMono-Regular',Consolas,'Courier New',monospace;font-size:14px;font-weight:700;letter-spacing:1.5px;color:#0f172a;">${escapeHtml(attendee.ticketCode)}</p>
              <p style="margin:6px 0 0;font-size:12px;color:#64748b;">Tunjukkan QR ini di gerbang masuk</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`).join('');

  const note = config?.description
    ? `<tr>
                <td style="padding:0 0 18px;">
                  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#fffbeb;border-radius:14px;">
                    <tr>
                      <td width="4" style="background:#f59e0b;border-radius:14px 0 0 14px;font-size:0;line-height:0;">&nbsp;</td>
                      <td style="padding:14px 16px;font-size:13px;line-height:1.6;color:#92400e;">${escapeHtml(config.description).replace(/\n/g, '<br />')}</td>
                    </tr>
                  </table>
                </td>
              </tr>`
    : '';

  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>E-Ticket ${eventName}</title>
</head>
<body style="margin:0;padding:0;background:#eef1f6;">
  <!-- Cuplikan yang muncul di daftar inbox, tidak ikut tampil saat email dibuka. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    ${attendees.length} tiket untuk ${eventName} &mdash; ${escapeHtml(order.orderCode)}
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#eef1f6;">
    <tr>
      <td align="center" style="padding:28px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;max-width:600px;">

          ${posterBanner}

          <tr>
            <td style="padding:26px 28px;background:#0f172a;border-radius:${headerRadius};">
              <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#fbbf24;">E-Ticket &middot; FORBASI Jawa Barat</p>
              <h1 style="margin:10px 0 0;font-size:24px;line-height:1.25;font-weight:800;color:#ffffff;">${eventName}</h1>
              <p style="margin:12px 0 0;font-size:13px;line-height:1.6;color:#94a3b8;">
                ${escapeHtml(schedule)}<br />${location}
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:26px 28px 24px;background:#ffffff;">
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155;">
                Halo <strong style="color:#0f172a;">${escapeHtml(order.buyerName)}</strong>, pembayaran Anda sudah kami terima.
                ${attendees.length > 1 ? `Berikut ${attendees.length} tiket Anda.` : 'Berikut tiket Anda.'}
                Selamat menikmati acaranya!
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #e2e8f0;border-radius:16px;">
                <tr>
                  <td width="50%" style="padding:16px 18px;vertical-align:top;">
                    ${summaryCell('Kode pesanan', `<span style="font-family:'SFMono-Regular',Consolas,'Courier New',monospace;letter-spacing:0.5px;">${escapeHtml(order.orderCode)}</span>`)}
                  </td>
                  <td width="50%" style="padding:16px 18px;vertical-align:top;">
                    ${summaryCell('Jenis tiket', `${typeName} &times; ${attendees.length}`)}
                    ${validDate}
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding:0 18px;">
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      <tr><td style="border-top:1px solid #f1f5f9;font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td width="50%" style="padding:16px 18px;vertical-align:top;">
                    ${summaryCell('Total dibayar', `<span style="font-size:20px;font-weight:800;">${formatCurrency(order.grossAmount || order.totalAmount)}</span>`, `Lunas ${escapeHtml(formatDateTime(order.paidAt))}`)}
                  </td>
                  <td width="50%" style="padding:16px 18px;vertical-align:top;">
                    ${summaryCell('Atas nama', escapeHtml(order.buyerName), escapeHtml(order.buyerEmail || ''))}
                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:22px;">
                ${note}
                ${ticketCards}
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:4px;background:#f8fafc;border-radius:14px;">
                <tr>
                  <td style="padding:14px 16px;font-size:12px;line-height:1.65;color:#64748b;">
                    Setiap QR hanya berlaku untuk satu kali pindai. Simpan email ini baik-baik dan jangan
                    membagikannya ke orang lain &mdash; siapa pun yang memegang kodenya bisa memakai tiket Anda.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 28px 22px;background:#ffffff;border-radius:0 0 20px 20px;border-top:1px solid #f1f5f9;">
              <p style="margin:0;font-size:11px;line-height:1.7;color:#94a3b8;">
                Email ini dikirim otomatis oleh FORBASI Jawa Barat. Bila ada kendala dengan tiket Anda,
                hubungi penyelenggara acara.
              </p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:18px 12px 0;">
              <p style="margin:0;font-size:11px;color:#94a3b8;">FORBASI Pengda Jawa Barat</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

const buildTicketEmailText = ({ event, order, attendees }) => {
  const lines = [
    `E-Ticket ${event?.namaEvent || 'Event'}`,
    `Kode pesanan: ${order.orderCode}`,
    `Pembeli: ${order.buyerName}`,
    `Jumlah tiket: ${attendees.length}`,
    '',
    'Kode tiket:',
    ...attendees.map((attendee, index) => `${index + 1}. ${attendee.name} — ${attendee.ticketCode}`),
    '',
    'Tunjukkan QR pada lampiran email ini di gerbang masuk.',
  ];
  return lines.join('\n');
};

// Kirim e-ticket satu pesanan. `overrideEmail` dipakai fitur kirim ulang ketika
// alamat pembeli salah tulis.
const sendTicketEmail = async ({ event, config, order, attendees, overrideEmail = null }) => {
  if (!isMailerConfigured()) {
    throw new Error('Pengiriman email belum dikonfigurasi (SMTP_HOST/SMTP_USER/SMTP_PASSWORD)');
  }
  const recipients = (attendees || []).filter(Boolean);
  if (recipients.length === 0) throw new Error('Pesanan ini belum punya tiket untuk dikirim');

  const to = String(overrideEmail || order.buyerEmail || '').trim();
  if (!to) throw new Error('Alamat email tujuan tidak diketahui');
  // Pesanan loket tanpa email pembeli memakai alamat cadangan yang tidak ada
  // domainnya; tiketnya cukup dicatat kodenya di kartu hasil loket.
  if (isPlaceholderEmail(to)) {
    throw new Error('Pesanan ini tidak punya alamat email pembeli. Isi alamat tujuan untuk mengirim e-ticket.');
  }

  const attachments = await Promise.all(recipients.map(async (attendee) => ({
    filename: `${attendee.ticketCode}.png`,
    content: await renderTicketQr(attendee.ticketCode),
    cid: attendee.ticketCode,
  })));

  // Poster tiket didahulukan atas poster berkas rekomendasi, sama seperti yang
  // tampil di halaman penjualan.
  const poster = await buildPosterAttachment(config?.poster || event?.poster);
  if (poster) attachments.unshift(poster);

  return sendMail({
    to,
    subject: `E-Ticket ${event?.namaEvent || 'Event'} — ${order.orderCode}`,
    html: buildTicketEmailHtml({ event, config, order, attendees: recipients, hasPoster: !!poster }),
    text: buildTicketEmailText({ event, order, attendees: recipients }),
    attachments,
  });
};

// Pengiriman yang tidak pernah melempar error. Dipakai di jalur webhook/checkout:
// pembayaran yang sudah lunas tidak boleh digagalkan oleh SMTP yang sedang rewel.
const sendTicketEmailSafe = async (payload) => {
  try {
    await sendTicketEmail(payload);
    return { sent: true, error: null };
  } catch (error) {
    console.error(`[Ticket] Gagal mengirim e-ticket ${payload?.order?.orderCode}:`, error.message);
    return { sent: false, error: error.message };
  }
};

module.exports = { renderTicketQr, buildTicketEmailHtml, buildPosterAttachment, sendTicketEmail, sendTicketEmailSafe };
