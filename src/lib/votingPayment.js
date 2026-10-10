const { invalidateEventVotersSafe } = require('./votersFeed');
const { jadwalEfektifKategori } = require('./jadwalKategoriVoting');

const VOTING_ADMIN_FEE_PER_VOTE = 500;
const VOTING_MAX_ADMIN_FEE = 10000;

/* Kartu gift booster, disamakan dengan Simpaskor. Harus sepadan dengan GIFTS
   di frontend (components/voting/BoostPurchaseModal.jsx). */
const VOTING_GIFT_VOTES = { flame: 10, bear: 20, rocket: 50, lion: 100 };

/* Gift hanya sah kalau jumlah vote-nya persis harga kartunya. Frontend
   menurunkan gift dari jumlah vote, jadi kiriman yang tidak cocok berarti
   pembeli mengubah jumlahnya sesudah memilih kartu — itu vote custom, dan
   popup-nya tidak boleh mengaku "Singa" untuk 37 vote. */
const sanitizeVotingGift = (giftType, voteCount) => {
  const key = typeof giftType === 'string' ? giftType.trim().toLowerCase() : '';
  return VOTING_GIFT_VOTES[key] === Number(voteCount) ? key : null;
};

/* Efek suara popup per tier, disamakan dengan Simpaskor. HARUS sama dengan
   SFX_PRESETS di frontend/src/lib/sfxVoting.js — kunci di luar daftar ini
   dibuang jadi null dan popupnya memakai bunyi bawaan gift. */
const VOTING_SFX_TIER = {
  5: ['005-bonk', '005-mario-jump', '005-taco-bell', '005-wow'],
  10: ['010-emotional-damage', '010-fahhhh', '010-fbi-open-up', '010-mama-gufron', '010-oh-my-god', '010-the-prowler', '010-vine-boom'],
  20: ['020-alarm', '020-hormat-pati', '020-rizz', '020-saya-akan-lawan', '020-saya-masih-sanggup', '020-selebew'],
  50: ['050-chipi-chipi', '050-haaland', '050-irup-masuk', '050-no-enemy'],
  100: ['100-ajojing', '100-mancing-mania'],
};

/* Tier tertinggi yang ≤ jumlah vote (37 vote → tier 20), atau null di bawah 5. */
const tierSfxVoting = (voteCount) => [100, 50, 20, 10, 5].find((tier) => Number(voteCount) >= tier) ?? null;

/* Suara hanya sah dari daftar tier yang dibayar: 30 vote tidak boleh berbunyi
   seperti 50 hanya karena frontend lupa melepas pilihan lamanya. */
const sanitizeVotingSfx = (sfxKey, voteCount) => {
  const tier = tierSfxVoting(voteCount);
  if (tier === null || typeof sfxKey !== 'string') return null;
  return VOTING_SFX_TIER[tier].includes(sfxKey) ? sfxKey : null;
};

/* Tarif yang berlaku untuk satu event. Kolom NULL berarti "ikut tarif bawaan",
   jadi event yang tidak pernah diatur sendiri tetap ikut saat bawaannya diubah. */
const angkaTarif = (nilai, bawaan) => {
  const n = Number(nilai);
  return nilai === null || nilai === undefined || !Number.isFinite(n) || n < 0 ? bawaan : Math.round(n);
};

const tarifAdminVoting = (config) => ({
  perVote: angkaTarif(config?.adminFeePerVote, VOTING_ADMIN_FEE_PER_VOTE),
  maksimum: angkaTarif(config?.adminFeeMax, VOTING_MAX_ADMIN_FEE),
});

/* `tarif` opsional supaya pemanggil lama tetap sah; tanpa itu dipakai tarif
   bawaan, persis seperti sebelum tarif per event ada. */
const calculateVotingAdminFee = (totalAmount, voteCount, tarif) => {
  const amount = Number(totalAmount) || 0;
  const votes = Number.parseInt(voteCount, 10) || 0;
  if (amount <= 0 || votes <= 0) return 0;
  const perVote = angkaTarif(tarif?.perVote, VOTING_ADMIN_FEE_PER_VOTE);
  const maksimum = angkaTarif(tarif?.maksimum, VOTING_MAX_ADMIN_FEE);
  return Math.min(perVote * votes, maksimum);
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
      rekomendasiEventId: true,
      categoryId: true,
      event: { select: { votingConfig: { select: { startDate: true, endDate: true } } } },
    },
  });

  if (!purchase) return { applied: false, cancelled: false };
  if (purchase.status === 'PAID') return { applied: false, cancelled: false };

  // Batas tutupnya jadwal efektif KATEGORI, yang bisa lebih awal dari arena.
  const kategori = purchase.categoryId
    ? await db.votingCategory.findUnique({
      where: { id: purchase.categoryId },
      select: { ikutiJadwalArena: true, startDate: true, endDate: true },
    })
    : null;
  const { endDate } = jadwalEfektifKategori(kategori, purchase.event?.votingConfig);
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

  // Vote sudah ter-commit — segarkan ticker voter agar pesan pendukung ini
  // langsung tampil. Sengaja di luar transaksi dan tidak pernah melempar error,
  // supaya pembayaran yang sudah berhasil tidak bisa digagalkan oleh cache.
  invalidateEventVotersSafe(purchase.rekomendasiEventId);

  return { applied: true, cancelled: false };
};

module.exports = {
  VOTING_ADMIN_FEE_PER_VOTE,
  VOTING_MAX_ADMIN_FEE,
  VOTING_GIFT_VOTES,
  sanitizeVotingGift,
  sanitizeVotingSfx,
  tierSfxVoting,
  tarifAdminVoting,
  calculateVotingAdminFee,
  calculateVotingRevenueSplit,
  applyPaidVotingPurchaseVotes,
  finalizeVotingPurchaseSuccess,
};
