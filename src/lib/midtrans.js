const crypto = require('crypto');
const path = require('path');

if (!process.env.MIDTRANS_SERVER_KEY || !process.env.MIDTRANS_CLIENT_KEY) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
}

const getMidtransConfig = () => ({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
  serverKey: process.env.MIDTRANS_SERVER_KEY || '',
  clientKey: process.env.MIDTRANS_CLIENT_KEY || '',
});

const getSnapBaseUrl = () =>
  getMidtransConfig().isProduction
    ? 'https://app.midtrans.com/snap/v1'
    : 'https://app.sandbox.midtrans.com/snap/v1';

const getCoreBaseUrl = () =>
  getMidtransConfig().isProduction
    ? 'https://api.midtrans.com/v2'
    : 'https://api.sandbox.midtrans.com/v2';

// This Midtrans account is shared by several apps, but the dashboard allows only
// ONE payment notification URL (currently another app's). Override it per
// transaction so voting (VOT-*) callbacks reach THIS backend instead.
const getNotificationUrl = () =>
  process.env.MIDTRANS_NOTIFICATION_URL || 'https://jabar.forbasi.or.id/api/payments/notification';

const QRIS_FEE_RATE = 0.007;

const isMidtransConfigured = () => {
  const { serverKey, clientKey } = getMidtransConfig();
  return Boolean(serverKey && clientKey);
};

const getAuthHeader = () => {
  const { serverKey } = getMidtransConfig();
  return `Basic ${Buffer.from(`${serverKey}:`).toString('base64')}`;
};

const normalizeMoney = (value) => Math.max(0, Math.round(Number(value) || 0));

// Midtrans expiry.start_time format: "yyyy-MM-dd HH:mm:ss +0000" (formatted in UTC).
const formatMidtransTime = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`
  );
};

const calculateQrisFee = (originalAmount) => {
  const base = normalizeMoney(originalAmount);
  if (base <= 0) return { grossAmount: 0, fee: 0 };
  const grossAmount = Math.ceil(base / (1 - QRIS_FEE_RATE));
  return { grossAmount, fee: grossAmount - base };
};

const createSnapTransaction = async ({
  orderId,
  grossAmount,
  customerName,
  customerEmail,
  customerPhone,
  adminFee = 0,
  itemDetails = [],
  expiryDurationSeconds = null,
}) => {
  if (!isMidtransConfigured()) {
    throw new Error('Midtrans belum dikonfigurasi');
  }

  const baseAmount = normalizeMoney(grossAmount) + normalizeMoney(adminFee);
  const { grossAmount: totalWithFee, fee } = calculateQrisFee(baseAmount);
  const items = itemDetails.map((item) => ({
    id: String(item.id).slice(0, 50),
    price: normalizeMoney(item.price),
    quantity: Math.max(1, Number.parseInt(item.quantity, 10) || 1),
    name: String(item.name || 'Item').slice(0, 50),
  }));

  if (adminFee > 0) {
    items.push({
      id: 'ADMIN_FEE',
      price: normalizeMoney(adminFee),
      quantity: 1,
      name: 'Biaya Admin',
    });
  }

  if (fee > 0) {
    items.push({
      id: 'QRIS_FEE',
      price: fee,
      quantity: 1,
      name: 'Biaya Layanan QRIS',
    });
  }

  // Bind the payment window to the voting close time. A QRIS code that is no
  // longer valid cannot be paid, so a transaction started seconds before close
  // expires (and is rejected by Midtrans) instead of settling after close.
  //
  // Midtrans expiry granularity is whole minutes, so a naive `floor/ceil` of the
  // remaining seconds would let the QRIS outlive the close by up to a minute. To
  // land the expiry on the exact intended instant we round the duration UP to the
  // next minute and back-date `start_time` so `start_time + duration` equals
  // `now + durationSeconds`. start_time is at most ~59s in the past (Midtrans
  // accepts that) and never in the future for our inputs.
  let expiry;
  const durationSeconds = Math.floor(Number(expiryDurationSeconds) || 0);
  if (durationSeconds > 0) {
    const durationMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
    const startTime = new Date(Date.now() + durationSeconds * 1000 - durationMinutes * 60 * 1000);
    expiry = {
      start_time: formatMidtransTime(startTime),
      unit: 'minute',
      duration: durationMinutes,
    };
  }

  const response = await fetch(`${getSnapBaseUrl()}/transactions`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: getAuthHeader(),
      // Route this transaction's notification to our endpoint regardless of the
      // shared account's dashboard URL.
      ...(getNotificationUrl() ? { 'X-Override-Notification': getNotificationUrl() } : {}),
    },
    body: JSON.stringify({
      transaction_details: {
        order_id: orderId,
        gross_amount: totalWithFee,
      },
      customer_details: {
        first_name: customerName,
        email: customerEmail,
        phone: customerPhone || '',
      },
      item_details: items,
      enabled_payments: ['other_qris'],
      ...(expiry ? { expiry } : {}),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error_messages?.join(', ') || payload?.message || 'Gagal membuat transaksi Midtrans');
  }

  return {
    token: payload.token,
    redirectUrl: payload.redirect_url,
    grossAmount: totalWithFee,
    qrisFee: fee,
  };
};

const getTransactionStatus = async (orderId) => {
  if (!isMidtransConfigured()) {
    throw new Error('Midtrans belum dikonfigurasi');
  }

  const response = await fetch(`${getCoreBaseUrl()}/${encodeURIComponent(orderId)}/status`, {
    headers: {
      Accept: 'application/json',
      Authorization: getAuthHeader(),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.status_message || payload?.message || 'Gagal mengambil status Midtrans');
  }
  return payload;
};

// Cancel a transaction that has not settled yet (e.g. abandoned checkout).
const cancelTransaction = async (orderId) => {
  if (!isMidtransConfigured()) {
    throw new Error('Midtrans belum dikonfigurasi');
  }
  const response = await fetch(`${getCoreBaseUrl()}/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: getAuthHeader(),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.status_message || payload?.message || 'Gagal membatalkan transaksi Midtrans');
  }
  return payload;
};

// Refund a transaction that already settled but must not be honored
// (e.g. payment completed after voting closed).
const refundTransaction = async (orderId, { amount, reason } = {}) => {
  if (!isMidtransConfigured()) {
    throw new Error('Midtrans belum dikonfigurasi');
  }
  const response = await fetch(`${getCoreBaseUrl()}/${encodeURIComponent(orderId)}/refund`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: getAuthHeader(),
    },
    body: JSON.stringify({
      reason: reason || 'Voting sudah ditutup',
      ...(amount ? { amount: normalizeMoney(amount) } : {}),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.status_message || payload?.message || 'Gagal refund transaksi Midtrans');
  }
  return payload;
};

const verifySignature = ({ order_id, status_code, gross_amount, signature_key }) => {
  const { serverKey } = getMidtransConfig();
  if (!serverKey || !signature_key) return false;
  const hash = crypto
    .createHash('sha512')
    .update(`${order_id}${status_code}${gross_amount}${serverKey}`)
    .digest('hex');
  return hash === signature_key;
};

const resolvePaymentStatus = (transactionStatus, fraudStatus) => {
  if (transactionStatus === 'capture') {
    return fraudStatus === 'accept' ? 'success' : 'pending';
  }
  if (transactionStatus === 'settlement') return 'success';
  if (['cancel', 'deny', 'refund', 'partial_refund'].includes(transactionStatus)) return 'failed';
  if (transactionStatus === 'expire') return 'expired';
  return 'pending';
};

module.exports = {
  MIDTRANS_CLIENT_KEY: getMidtransConfig().clientKey,
  MIDTRANS_IS_PRODUCTION: getMidtransConfig().isProduction,
  QRIS_FEE_RATE,
  calculateQrisFee,
  createSnapTransaction,
  cancelTransaction,
  refundTransaction,
  getTransactionStatus,
  isMidtransConfigured,
  resolvePaymentStatus,
  verifySignature,
};
