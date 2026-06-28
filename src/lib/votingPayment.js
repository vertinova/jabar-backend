const VOTING_ADMIN_FEE_PER_VOTE = 500;
const VOTING_MAX_ADMIN_FEE = 10000;

const calculateVotingAdminFee = (totalAmount, voteCount) => {
  const amount = Number(totalAmount) || 0;
  const votes = Number.parseInt(voteCount, 10) || 0;
  if (amount <= 0 || votes <= 0) return 0;
  return Math.min(VOTING_ADMIN_FEE_PER_VOTE * votes, VOTING_MAX_ADMIN_FEE);
};

const calculateVotingRevenueSplit = (totalAmount, organizerSharePercent, pengdaSharePercent) => {
  const amount = Math.max(0, Math.round(Number(totalAmount) || 0));
  const organizerPercent = Number(organizerSharePercent) || 0;
  const pengdaPercent = Number(pengdaSharePercent) || 0;
  const organizerAmount = Math.round((amount * organizerPercent) / 100);

  return {
    organizerSharePercent: organizerPercent,
    pengdaSharePercent: pengdaPercent,
    organizerShareAmount: organizerAmount,
    pengdaShareAmount: Math.max(0, amount - organizerAmount),
  };
};

const applyPaidVotingPurchaseVotes = async (tx, purchaseId, voterIp = '') => {
  const purchase = await tx.votingPurchase.findUnique({
    where: { id: purchaseId },
    select: {
      id: true,
      categoryId: true,
      nomineeId: true,
      voteCount: true,
      usedVotes: true,
      buyerName: true,
      buyerEmail: true,
    },
  });

  if (!purchase?.categoryId || !purchase?.nomineeId) return 0;

  const remainingVotes = Math.max(0, purchase.voteCount - purchase.usedVotes);
  if (remainingVotes <= 0) return 0;

  await tx.votingVote.createMany({
    data: Array.from({ length: remainingVotes }, () => ({
      categoryId: purchase.categoryId,
      nomineeId: purchase.nomineeId,
      purchaseId: purchase.id,
      voterName: purchase.buyerName,
      voterEmail: purchase.buyerEmail,
      voterIp,
    })),
  });

  await tx.votingNominee.update({
    where: { id: purchase.nomineeId },
    data: { voteCount: { increment: remainingVotes } },
  });

  await tx.votingPurchase.update({
    where: { id: purchase.id },
    data: { usedVotes: { increment: remainingVotes } },
  });

  return remainingVotes;
};

// Finalize a purchase whose payment Midtrans reports as successful.
//
// Rule: a vote only counts if the payment settles while voting is still open.
// If voting has already closed by the time the payment settles, the transaction
// FAILS — the buyer is refunded (best effort) and the purchase is cancelled, so
// a payment that lands after close never becomes a vote-granting transaction.
// (The QRIS expiry is also bound to the close time at checkout, so this race is
// rare; this is the safety net for the few seconds of payment-processing lag.)
//
// `db` is a PrismaClient (not a transaction — this opens its own transaction
// for the success path). `refund` is an async fn (orderId) => Promise used to
// trigger a Midtrans refund when voting has already closed.
const finalizeVotingPurchaseSuccess = async (db, purchaseId, { paymentType = null, refund } = {}) => {
  const purchase = await db.votingPurchase.findUnique({
    where: { id: purchaseId },
    select: {
      id: true,
      status: true,
      paidAt: true,
      midtransOrderId: true,
      event: { select: { votingConfig: { select: { endDate: true } } } },
    },
  });

  if (!purchase) return { applied: false, cancelled: false };
  if (purchase.status === 'PAID') return { applied: false, cancelled: false };

  const endDate = purchase.event?.votingConfig?.endDate;
  const votingClosed = endDate && new Date() > new Date(endDate);

  if (votingClosed) {
    if (typeof refund === 'function' && purchase.midtransOrderId) {
      try {
        await refund(purchase.midtransOrderId);
      } catch (refundError) {
        console.error(
          `[Voting] Gagal refund pembayaran setelah voting ditutup (${purchase.midtransOrderId}):`,
          refundError.message
        );
      }
    }
    await db.votingPurchase.update({
      where: { id: purchase.id },
      data: { status: 'CANCELLED', paymentType },
    });
    return { applied: false, cancelled: true };
  }

  await db.$transaction(async (tx) => {
    await tx.votingPurchase.update({
      where: { id: purchase.id },
      data: {
        status: 'PAID',
        paymentType,
        paidAt: purchase.paidAt || new Date(),
      },
    });
    await applyPaidVotingPurchaseVotes(tx, purchase.id);
  });
  return { applied: true, cancelled: false };
};

module.exports = {
  VOTING_ADMIN_FEE_PER_VOTE,
  VOTING_MAX_ADMIN_FEE,
  calculateVotingAdminFee,
  calculateVotingRevenueSplit,
  applyPaidVotingPurchaseVotes,
  finalizeVotingPurchaseSuccess,
};
