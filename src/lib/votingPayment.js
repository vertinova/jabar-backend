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
// A payment that Midtrans has already SETTLED is always honored as PAID and its
// votes are counted — even if the settlement timestamp lands a few seconds after
// the voting close time. The buyer paid in good faith within the QRIS validity
// window (that window is bound to the voting close time when the transaction is
// created), and the money has actually been taken. Refunding/cancelling an
// already-settled payment is exactly what produced the "paid but cancelled"
// problem, so we never do that here.
//
// Stragglers are prevented up front: the QRIS expiry is capped at the close time
// at checkout, so a buyer cannot start paying long after voting ends.
//
// `db` is a PrismaClient (not a transaction — this opens its own transaction).
// The legacy `refund` option is accepted for backward compatibility but ignored.
const finalizeVotingPurchaseSuccess = async (db, purchaseId, { paymentType = null } = {}) => {
  const purchase = await db.votingPurchase.findUnique({
    where: { id: purchaseId },
    select: {
      id: true,
      status: true,
      paidAt: true,
    },
  });

  if (!purchase) return { applied: false, cancelled: false };
  if (purchase.status === 'PAID') return { applied: false, cancelled: false };

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
