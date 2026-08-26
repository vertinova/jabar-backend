// Penyapu pesanan tiket yang menggantung.
//
// Kuota dipesan saat pesanan dibuat, jadi pesanan PENDING yang pembelinya pergi
// begitu saja akan menahan kursi selamanya kalau tidak ada yang menghanguskannya.
// Webhook Midtrans menutup sebagian besar kasus (`expire`/`cancel`), penyapu ini
// jaring pengaman untuk notifikasi yang tidak pernah sampai.
//
// TTL-nya sengaja lebih panjang dari masa berlaku QRIS Midtrans (CHECKOUT_EXPIRY,
// bawaan 15 menit) supaya penyapu tidak pernah mendahului webhook yang masih sah.
const prisma = require('./prisma');
const { cancelOrderAndReleaseQuota } = require('./ticketing');

const SWEEP_INTERVAL_MS = (Number(process.env.TICKET_SWEEP_INTERVAL_MINUTES) || 5) * 60 * 1000;
const PENDING_TTL_MS = (Number(process.env.TICKET_PENDING_TTL_MINUTES) || 30) * 60 * 1000;

let timer = null;

const sweepPendingTicketOrders = async () => {
  const cutoff = new Date(Date.now() - PENDING_TTL_MS);
  const stale = await prisma.ticketOrder.findMany({
    where: { status: 'PENDING', createdAt: { lt: cutoff } },
    select: { id: true, orderCode: true },
    take: 200,
  });

  let expired = 0;
  for (const order of stale) {
    try {
      // cancelOrderAndReleaseQuota idempoten: pesanan yang sudah ditutup jalur
      // lain (webhook, pembatalan pembeli) dilewati, jadi kuota tidak pernah
      // dilepas dua kali.
      const { released } = await cancelOrderAndReleaseQuota(prisma, order.id, 'EXPIRED');
      if (released) expired += 1;
    } catch (error) {
      console.error(`[Ticket] Gagal menghanguskan pesanan ${order.orderCode}:`, error.message);
    }
  }

  if (expired > 0) {
    console.log(`[Ticket] ${expired} pesanan kedaluwarsa dihanguskan, kuotanya dikembalikan`);
  }
  return expired;
};

const startPendingTicketSweeper = () => {
  if (timer) return timer;
  timer = setInterval(() => {
    sweepPendingTicketOrders().catch((error) => {
      console.error('[Ticket] Penyapu pesanan gagal:', error.message);
    });
  }, SWEEP_INTERVAL_MS);
  // Jangan menahan proses tetap hidup hanya demi penyapu.
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
};

const stopPendingTicketSweeper = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = { sweepPendingTicketOrders, startPendingTicketSweeper, stopPendingTicketSweeper };
