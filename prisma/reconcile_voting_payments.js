/**
 * Rekonsiliasi pembayaran voting yang nyangkut PENDING.
 *
 * Jaring pengaman bila webhook Midtrans (POST /api/payments/notification) tidak
 * sampai: menyapu votingPurchase berstatus PENDING, mengecek status sebenarnya
 * ke Midtrans, lalu menyelaraskan status lokal.
 *
 *   - settle/capture tepat waktu  -> PAID + vote diterapkan
 *   - settle/capture SETELAH voting ditutup -> dilewati (tetap PENDING) untuk
 *     ditinjau manual (refund vs tetap dihitung adalah keputusan Pengda)
 *   - expire -> EXPIRED, deny/cancel -> CANCELLED
 *
 * Default DRY-RUN (tidak mengubah apa pun). Tambahkan --apply untuk eksekusi.
 *
 * Hanya menyentuh transaksi yang berumur minimal MIN_AGE_MINUTES (default 5)
 * agar tidak mengganggu checkout yang sedang berjalan.
 *
 * Jalankan:
 *   node prisma/reconcile_voting_payments.js            # dry-run
 *   node prisma/reconcile_voting_payments.js --apply    # eksekusi
 *
 * Cocok dijadikan cron, mis. tiap 10 menit:
 *   *\/10 * * * * cd /var/www/jabar/backend && /usr/bin/node prisma/reconcile_voting_payments.js --apply >> /var/log/voting-reconcile.log 2>&1
 */
const prisma = require('../src/lib/prisma');
const { getTransactionStatus, resolvePaymentStatus } = require('../src/lib/midtrans');
const { applyPaidVotingPurchaseVotes } = require('../src/lib/votingPayment');

const APPLY = process.argv.includes('--apply');
const MIN_AGE_MINUTES = Number(process.env.RECONCILE_MIN_AGE_MINUTES || 5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Midtrans mengembalikan waktu WIB "YYYY-MM-DD HH:mm:ss" (GMT+7).
const parseWIB = (s) => (s ? new Date(s.replace(' ', 'T') + '+07:00') : null);

async function main() {
  const cutoff = new Date(Date.now() - MIN_AGE_MINUTES * 60 * 1000);
  const list = await prisma.votingPurchase.findMany({
    where: { status: 'PENDING', midtransOrderId: { not: null }, createdAt: { lt: cutoff } },
    select: {
      id: true,
      purchaseCode: true,
      midtransOrderId: true,
      paidAt: true,
      event: { select: { votingConfig: { select: { endDate: true } } } },
    },
  });

  const stats = { total: list.length, paid: 0, votes: 0, expired: 0, cancelled: 0, late: 0, pending: 0, error: 0 };
  console.log(`[reconcile] ${APPLY ? 'APPLY' : 'DRY-RUN'} — ${list.length} PENDING (umur > ${MIN_AGE_MINUTES} mnt)`);

  for (const p of list) {
    try {
      const tx = await getTransactionStatus(p.midtransOrderId);
      const result = resolvePaymentStatus(tx.transaction_status, tx.fraud_status);

      if (result === 'success') {
        const endDate = p.event?.votingConfig?.endDate ? new Date(p.event.votingConfig.endDate) : null;
        const settledAt = parseWIB(tx.settlement_time) || parseWIB(tx.transaction_time) || new Date();
        if (endDate && settledAt > endDate) {
          stats.late += 1;
          console.log(`  LATE  ${p.purchaseCode} (settle ${tx.settlement_time} > tutup ${endDate.toISOString()}) — dilewati`);
          continue;
        }
        if (APPLY) {
          const applied = await prisma.$transaction(async (t) => {
            await t.votingPurchase.update({
              where: { id: p.id },
              data: { status: 'PAID', paymentType: tx.payment_type || null, paidAt: p.paidAt || settledAt },
            });
            return applyPaidVotingPurchaseVotes(t, p.id);
          });
          stats.votes += applied;
          console.log(`  PAID  ${p.purchaseCode} +${applied} vote`);
        } else {
          console.log(`  PAID  ${p.purchaseCode} (akan menerapkan vote)`);
        }
        stats.paid += 1;
      } else if (result === 'expired') {
        if (APPLY) {
          await prisma.votingPurchase.update({ where: { id: p.id }, data: { status: 'EXPIRED', paymentType: tx.payment_type || null } });
        }
        stats.expired += 1;
      } else if (result === 'failed') {
        if (APPLY) {
          await prisma.votingPurchase.update({ where: { id: p.id }, data: { status: 'CANCELLED', paymentType: tx.payment_type || null } });
        }
        stats.cancelled += 1;
      } else {
        stats.pending += 1;
      }
    } catch (error) {
      stats.error += 1;
      console.log(`  ERR   ${p.purchaseCode}: ${error.message}`);
    }
    await sleep(200);
  }

  console.log('[reconcile] selesai', stats);
}

main()
  .catch((e) => { console.error('[reconcile] fatal:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
