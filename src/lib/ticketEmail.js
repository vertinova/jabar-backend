// E-ticket: satu email ke alamat PEMBELI berisi QR setiap penonton sebagai
// lampiran gambar — bukan satu email per penonton. Peserta yang alamatnya diisi
// tetap tidak menerima email sendiri; bila alamat pembeli salah tulis, panitia
// memakai "Kirim Ulang Email" dan mengubah alamat tujuannya.
const QRCode = require('qrcode');
const { sendMail, isMailerConfigured } = require('./mailer');
const { isPlaceholderEmail } = require('./ticketing');

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

const buildTicketEmailHtml = ({ event, config, order, attendees }) => {
  const eventName = escapeHtml(event?.namaEvent || 'Event');
  const location = escapeHtml(event?.lokasi || '-');
  const schedule = event?.tanggalMulai
    ? `${formatDate(event.tanggalMulai)}${event.tanggalSelesai && String(event.tanggalSelesai) !== String(event.tanggalMulai) ? ` – ${formatDate(event.tanggalSelesai)}` : ''}`
    : '-';
  const typeName = order.ticketType?.name ? escapeHtml(order.ticketType.name) : 'Tiket Masuk';
  const validDate = order.ticketType?.kind === 'DAY' && order.ticketType?.validDate
    ? `<p style="margin:4px 0 0;font-size:13px;color:#b45309;">Tiket ini hanya berlaku pada ${escapeHtml(formatDate(order.ticketType.validDate))}.</p>`
    : '';

  const ticketCards = attendees.map((attendee, index) => `
    <tr>
      <td style="padding:0 0 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;background:#ffffff;">
          <tr>
            <td style="padding:20px;" align="center">
              <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#f59e0b;">Tiket ${index + 1} dari ${attendees.length}</p>
              <p style="margin:0 0 12px;font-size:17px;font-weight:800;color:#111827;">${escapeHtml(attendee.name)}</p>
              <img src="cid:${attendee.ticketCode}" alt="QR ${escapeHtml(attendee.ticketCode)}" width="200" height="200" style="display:block;margin:0 auto;border-radius:12px;" />
              <p style="margin:12px 0 0;font-family:'Courier New',monospace;font-size:14px;font-weight:700;letter-spacing:1px;color:#111827;">${escapeHtml(attendee.ticketCode)}</p>
              <p style="margin:6px 0 0;font-size:12px;color:#6b7280;">Tunjukkan QR ini di gerbang masuk</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`).join('');

  const note = config?.description
    ? `<tr><td style="padding:16px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;font-size:13px;color:#92400e;">${escapeHtml(config.description).replace(/\n/g, '<br />')}</td></tr><tr><td style="height:16px;"></td></tr>`
    : '';

  return `<!doctype html>
<html lang="id">
<body style="margin:0;padding:24px 12px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          <tr>
            <td style="padding:24px;background:#111827;border-radius:16px 16px 0 0;">
              <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#fbbf24;">E-Ticket FORBASI Jabar</p>
              <h1 style="margin:0;font-size:20px;font-weight:800;color:#ffffff;">${eventName}</h1>
              <p style="margin:8px 0 0;font-size:13px;color:#d1d5db;">${escapeHtml(schedule)} &bull; ${location}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px;background:#ffffff;">
              <p style="margin:0 0 16px;font-size:14px;color:#374151;">Halo <strong>${escapeHtml(order.buyerName)}</strong>, pembayaran Anda sudah kami terima. Berikut ${attendees.length} tiket Anda.</p>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;border:1px solid #e5e7eb;border-radius:12px;">
                <tr><td style="padding:14px 16px;">
                  <p style="margin:0;font-size:12px;color:#6b7280;">Kode pesanan</p>
                  <p style="margin:2px 0 10px;font-family:'Courier New',monospace;font-size:15px;font-weight:700;color:#111827;">${escapeHtml(order.orderCode)}</p>
                  <p style="margin:0;font-size:12px;color:#6b7280;">Jenis tiket</p>
                  <p style="margin:2px 0 0;font-size:14px;font-weight:700;color:#111827;">${typeName} &times; ${attendees.length}</p>
                  ${validDate}
                  <p style="margin:10px 0 0;font-size:12px;color:#6b7280;">Total dibayar</p>
                  <p style="margin:2px 0 0;font-size:16px;font-weight:800;color:#111827;">${formatCurrency(order.grossAmount || order.totalAmount)}</p>
                  <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;">Dibayar ${escapeHtml(formatDateTime(order.paidAt))}</p>
                </td></tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0">
                ${note}
                ${ticketCards}
              </table>

              <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">Setiap QR hanya bisa dipindai satu kali. Jangan bagikan tiket ini ke orang lain.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 20px;background:#f9fafb;border-radius:0 0 16px 16px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:11px;color:#9ca3af;">Email ini dikirim otomatis oleh FORBASI Jawa Barat. Bila ada kendala, hubungi penyelenggara event.</p>
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

  return sendMail({
    to,
    subject: `E-Ticket ${event?.namaEvent || 'Event'} — ${order.orderCode}`,
    html: buildTicketEmailHtml({ event, config, order, attendees: recipients }),
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

module.exports = { renderTicketQr, sendTicketEmail, sendTicketEmailSafe };
