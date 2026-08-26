// Pengirim email SMTP.
//
// Konfigurasi lewat .env; bila belum diisi, `isMailerConfigured()` mengembalikan
// false dan seluruh pemanggil bisa memilih melewati pengiriman tanpa menggagalkan
// transaksi yang sudah lunas. Pembayaran yang berhasil TIDAK boleh dibatalkan
// hanya karena email gagal terkirim.
//
//   SMTP_HOST=smtp.gmail.com
//   SMTP_PORT=587
//   SMTP_SECURE=false          # true untuk port 465
//   SMTP_USER=akun@domain.id
//   SMTP_PASSWORD=app-password
//   SMTP_FROM_NAME=FORBASI Jabar
//   SMTP_FROM_EMAIL=akun@domain.id   # default: SMTP_USER
const path = require('path');
const nodemailer = require('nodemailer');

if (!process.env.SMTP_HOST) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
}

let cachedTransport = null;
let cachedSignature = '';

const getMailerConfig = () => ({
  host: process.env.SMTP_HOST || '',
  port: Number.parseInt(process.env.SMTP_PORT, 10) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  user: process.env.SMTP_USER || '',
  password: process.env.SMTP_PASSWORD || '',
  fromName: process.env.SMTP_FROM_NAME || 'FORBASI Jabar',
  fromEmail: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || '',
});

const isMailerConfigured = () => {
  const { host, user, password } = getMailerConfig();
  return Boolean(host && user && password);
};

// Transport dipakai ulang antar pengiriman (koneksi SMTP mahal untuk dibuka
// setiap email), tapi dibuang begitu konfigurasinya berubah.
const getTransport = () => {
  const config = getMailerConfig();
  const signature = `${config.host}|${config.port}|${config.secure}|${config.user}`;
  if (cachedTransport && cachedSignature === signature) return cachedTransport;

  cachedTransport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
  });
  cachedSignature = signature;
  return cachedTransport;
};

const sendMail = async ({ to, subject, html, text, attachments = [] }) => {
  if (!isMailerConfigured()) {
    throw new Error('Pengiriman email belum dikonfigurasi (SMTP_HOST/SMTP_USER/SMTP_PASSWORD)');
  }
  const { fromName, fromEmail } = getMailerConfig();
  return getTransport().sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    text,
    html,
    attachments,
  });
};

// Uji koneksi SMTP tanpa mengirim apa pun — dipakai panel admin untuk memastikan
// kredensial benar sebelum hari-H.
const verifyMailer = async () => {
  if (!isMailerConfigured()) {
    throw new Error('Pengiriman email belum dikonfigurasi (SMTP_HOST/SMTP_USER/SMTP_PASSWORD)');
  }
  return getTransport().verify();
};

module.exports = { getMailerConfig, isMailerConfigured, sendMail, verifyMailer };
