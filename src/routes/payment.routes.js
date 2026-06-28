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

    const paymentResult = resolvePaymentStatus(transactionStatus, fraudStatus);
    if (orderId.startsWith('VOT-')) {
      await handleVotingPayment(orderId, paymentResult, paymentType);
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

module.exports = router;
