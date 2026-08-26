const router = require('express').Router();
const prisma = require('../lib/prisma');
const {
  MIDTRANS_CLIENT_KEY,
  MIDTRANS_IS_PRODUCTION,
  resolvePaymentStatus,
  verifySignature,
  refundTransaction,
} = require('../lib/midtrans');
const { finalizeVotingPurchaseSuccess } = require('../lib/votingPayment');
const { cancelOrderAndReleaseQuota, markOrderPaid, isPlaceholderEmail } = require('../lib/ticketing');
const { sendTicketEmailSafe } = require('../lib/ticketEmail');

router.get('/client-key', (req, res) => {
  res.json({
    clientKey: MIDTRANS_CLIENT_KEY,
    isProduction: MIDTRANS_IS_PRODUCTION,
  });
});

router.post('/notification', async (req, res) => {
  try {
    const notification = req.body || {};
    const {
      order_id: orderId,
      transaction_status: transactionStatus,
      fraud_status: fraudStatus,
      status_code: statusCode,
      gross_amount: grossAmount,
      signature_key: signatureKey,
      payment_type: paymentType,
    } = notification;

    if (!orderId) return res.status(200).json({ status: 'ok' });

    if (!verifySignature({
      order_id: orderId,
      status_code: statusCode,
      gross_amount: grossAmount,
      signature_key: signatureKey,
    })) {
      console.warn(`[Midtrans] Signature tidak valid untuk ${orderId}`);
      return res.status(200).json({ status: 'ok', message: 'Invalid signature ignored' });
    }

    // Awalan order_id menentukan penanganannya: VOT- vote, TKT- tiket.
    const paymentResult = resolvePaymentStatus(transactionStatus, fraudStatus);
    if (orderId.startsWith('VOT-')) {
      await handleVotingPayment(orderId, paymentResult, paymentType);
    } else if (orderId.startsWith('TKT-')) {
      await handleTicketPayment(orderId, paymentResult, paymentType);
    }

    res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('[Midtrans] Notification error:', error);
    res.status(200).json({ status: 'ok' });
  }
});

async function handleVotingPayment(midtransOrderId, result, paymentType) {
  const purchase = await prisma.votingPurchase.findUnique({
    where: { midtransOrderId },
    select: { id: true, status: true, paidAt: true },
  });

  if (!purchase) {
    console.warn(`[Midtrans] Voting purchase tidak ditemukan: ${midtransOrderId}`);
    return;
  }

  if (purchase.status === 'PAID') return;
  if (['CANCELLED', 'EXPIRED'].includes(purchase.status) && result !== 'success') return;

  if (result === 'success') {
    // Counts votes only if it settles while voting is open; if voting already
    // closed, the transaction fails (refund + cancel).
    await finalizeVotingPurchaseSuccess(prisma, purchase.id, {
      paymentType: paymentType || null,
      refund: (orderId) => refundTransaction(orderId, {
        reason: 'Voting sudah ditutup sebelum pembayaran selesai',
      }),
    });
    return;
  }

  if (result === 'failed' || result === 'expired') {
    await prisma.votingPurchase.update({
      where: { id: purchase.id },
      data: {
        status: result === 'expired' ? 'EXPIRED' : 'CANCELLED',
        paymentType: paymentType || null,
      },
    });
  }
}

// Pesanan yang sudah berstatus akhir dilewati, sehingga notifikasi ganda aman.
// Kegagalan/kedaluwarsa melepas kuota acara DAN kuota jenis tiket lewat pelepas
// bersama di lib/ticketing.js.
async function handleTicketPayment(midtransOrderId, result, paymentType) {
  const order = await prisma.ticketOrder.findUnique({
    where: { midtransOrderId },
    select: { id: true, status: true, orderCode: true },
  });

  if (!order) {
    console.warn(`[Midtrans] Pesanan tiket tidak ditemukan: ${midtransOrderId}`);
    return;
  }

  if (['PAID', 'USED'].includes(order.status)) return;
  if (['CANCELLED', 'EXPIRED'].includes(order.status) && result !== 'success') return;

  if (result === 'success') {
    const { applied } = await markOrderPaid(prisma, order.id, { paymentType: paymentType || null });
    // E-ticket dikirim SETELAH pesanan tercatat lunas, dan kegagalannya tidak
    // pernah membatalkan pembayaran yang sudah masuk.
    if (applied) await deliverTicketEmailForOrder(order.id);
    return;
  }

  if (result === 'failed' || result === 'expired') {
    await cancelOrderAndReleaseQuota(prisma, order.id, result === 'expired' ? 'EXPIRED' : 'CANCELLED');
  }
}

async function deliverTicketEmailForOrder(orderId) {
  const order = await prisma.ticketOrder.findUnique({
    where: { id: orderId },
    include: {
      attendees: { orderBy: { id: 'asc' } },
      ticketType: true,
      config: true,
      event: true,
    },
  });
  if (!order) return;
  // Penjualan loket tanpa email pembeli tidak punya tujuan kirim.
  if (isPlaceholderEmail(order.buyerEmail)) return;

  const toNumber = (value) => (value === null || value === undefined ? 0 : Number(value));
  const { sent } = await sendTicketEmailSafe({
    event: order.event,
    config: order.config,
    order: {
      ...order,
      totalAmount: toNumber(order.totalAmount),
      grossAmount: order.grossAmount === null ? null : toNumber(order.grossAmount),
    },
    attendees: order.attendees,
  });

  if (sent) {
    await prisma.ticketOrder.update({
      where: { id: order.id },
      data: { emailSentAt: new Date() },
    });
  }
}

module.exports = router;
