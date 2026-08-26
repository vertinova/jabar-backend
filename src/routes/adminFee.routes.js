// ==================== REKAP BIAYA ADMIN E-VOTING ====================
//
// Biaya admin adalah pungutan tetap per vote (VOTING_ADMIN_FEE_PER_VOTE, dibatasi
// VOTING_MAX_ADMIN_FEE per transaksi) yang ditagihkan DI ATAS harga vote. Nilainya
// dibekukan di kolom `voting_purchases.admin_fee` saat checkout dibuat, jadi rekap
// di sini menjumlahkan angka yang benar-benar ditagihkan ke pembeli — bukan hasil
// hitung ulang — sehingga tetap akurat walau tarifnya berubah di kemudian hari.
//
// Berbeda dengan bagian penyelenggara/Pengda/Developer yang dipecah dari
// `total_amount`, biaya admin TIDAK masuk pool pembagian mana pun. Panel ini yang
// memonitornya, dipakai role DEVELOPER (dan SUPERADMIN/ADMIN).
const router = require('express').Router();
const { Prisma } = require('@prisma/client');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth.middleware');
const { ADMIN_FEE_ROLES } = require('../lib/roles');
const { VOTING_ADMIN_FEE_PER_VOTE, VOTING_MAX_ADMIN_FEE } = require('../lib/votingPayment');
const { TICKET_ADMIN_FEE_PER_TICKET, TICKET_EARNED_STATUSES } = require('../lib/ticketing');

const PURCHASE_STATUSES = ['PENDING', 'PAID', 'CANCELLED', 'EXPIRED'];

const canViewAdminFee = (req, res, next) => {
  if (ADMIN_FEE_ROLES.includes(req.user?.role)) return next();
  return res.status(403).json({ error: 'Akses ditolak' });
};

router.use(authenticate, canViewAdminFee);

const toNumber = (value) => (value === null || value === undefined ? 0 : Number(value));

const toId = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

// Rentang tanggal dari query. `to` diperlakukan inklusif (sampai akhir hari)
// supaya filter "1–31 Juli" ikut memuat transaksi tanggal 31.
const parseRange = (query) => {
  const parse = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const from = parse(query.from);
  const to = parse(query.to);
  if (to && String(query.to).length <= 10) to.setHours(23, 59, 59, 999);
  return { from, to };
};

// Filter Prisma (untuk agregasi lewat client) — dipakai bersama seluruh endpoint.
const buildWhere = (req) => {
  const { from, to } = parseRange(req.query);
  const where = {};

  const eventId = toId(req.query.eventId);
  if (eventId) where.rekomendasiEventId = eventId;

  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to) where.createdAt.lte = to;
  }

  const status = String(req.query.status || '').toUpperCase();
  if (PURCHASE_STATUSES.includes(status)) where.status = status;

  const term = String(req.query.search || '').trim();
  if (term) {
    where.OR = [
      { buyerName: { contains: term } },
      { buyerEmail: { contains: term } },
      { buyerPhone: { contains: term } },
      { purchaseCode: { contains: term } },
    ];
  }

  return where;
};

// Padanan buildWhere untuk query mentah (rekap per bulan butuh DATE_FORMAT yang
// tidak tersedia lewat groupBy Prisma). Sengaja hanya menerima filter rentang &
// event; pencarian teks tidak relevan untuk deret waktu.
const buildRawFilter = (req) => {
  const { from, to } = parseRange(req.query);
  const conditions = [Prisma.sql`status = 'PAID'`];
  const eventId = toId(req.query.eventId);
  if (eventId) conditions.push(Prisma.sql`rekomendasi_event_id = ${eventId}`);
  if (from) conditions.push(Prisma.sql`created_at >= ${from}`);
  if (to) conditions.push(Prisma.sql`created_at <= ${to}`);
  return Prisma.join(conditions, ' AND ');
};

// Padanan buildWhere untuk pesanan tiket. Statusnya punya satu nilai tambahan
// (USED = penontonnya sudah masuk gerbang) yang tetap terhitung sebagai pendapatan.
const TICKET_STATUSES = ['PENDING', 'PAID', 'USED', 'CANCELLED', 'EXPIRED'];

const buildTicketWhere = (req) => {
  const { from, to } = parseRange(req.query);
  const where = {};

  const eventId = toId(req.query.eventId);
  if (eventId) where.rekomendasiEventId = eventId;

  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to) where.createdAt.lte = to;
  }

  const status = String(req.query.status || '').toUpperCase();
  if (TICKET_STATUSES.includes(status)) where.status = status;

  const term = String(req.query.search || '').trim();
  if (term) {
    where.OR = [
      { buyerName: { contains: term } },
      { buyerEmail: { contains: term } },
      { buyerPhone: { contains: term } },
      { orderCode: { contains: term } },
    ];
  }

  return where;
};

// Rekap biaya admin penjualan tiket. Bentuknya sengaja sejajar dengan rekap vote
// supaya panel bisa menampilkannya berdampingan tanpa dua cara baca yang berbeda.
const buildTicketRecap = async (req) => {
  const where = buildTicketWhere(req);
  const { status: ignoredStatus, OR: ignoredSearch, ...scope } = where;
  const earned = { in: TICKET_EARNED_STATUSES };

  const [byStatus, paidTotals, paidByEvent, events] = await Promise.all([
    prisma.ticketOrder.groupBy({
      by: ['status'],
      where: scope,
      _sum: { adminFee: true, quantity: true, totalAmount: true },
      _count: true,
    }),
    prisma.ticketOrder.aggregate({
      where: { ...scope, status: earned },
      _sum: { adminFee: true, quantity: true, totalAmount: true, qrisFee: true, grossAmount: true },
      _count: true,
    }),
    prisma.ticketOrder.groupBy({
      by: ['rekomendasiEventId'],
      where: { ...scope, status: earned },
      _sum: { adminFee: true, quantity: true, totalAmount: true },
      _count: true,
    }),
    prisma.rekomendasiEvent.findMany({
      where: { ticketConfig: { isNot: null } },
      select: {
        id: true,
        namaEvent: true,
        penyelenggara: true,
        user: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const statusMap = Object.fromEntries(byStatus.map((row) => [row.status, row]));
  const statusFee = (status) => toNumber(statusMap[status]?._sum.adminFee);
  const eventMap = new Map(events.map((event) => [event.id, event]));

  const collectedFee = toNumber(paidTotals._sum.adminFee);
  const paidTickets = paidTotals._sum.quantity || 0;

  return {
    config: { perTicket: TICKET_ADMIN_FEE_PER_TICKET },
    summary: {
      collectedFee,
      paidTransactions: paidTotals._count,
      paidTickets,
      paidRevenue: toNumber(paidTotals._sum.totalAmount),
      qrisFee: toNumber(paidTotals._sum.qrisFee),
      grossAmount: toNumber(paidTotals._sum.grossAmount),
      avgFeePerTransaction: paidTotals._count ? collectedFee / paidTotals._count : 0,
      pendingFee: statusFee('PENDING'),
      pendingTransactions: statusMap.PENDING?._count || 0,
      lostFee: statusFee('EXPIRED') + statusFee('CANCELLED'),
      lostTransactions: (statusMap.EXPIRED?._count || 0) + (statusMap.CANCELLED?._count || 0),
    },
    byStatus: TICKET_STATUSES.map((status) => ({
      status,
      transactions: statusMap[status]?._count || 0,
      tickets: statusMap[status]?._sum.quantity || 0,
      adminFee: statusFee(status),
    })),
    byEvent: paidByEvent
      .map((row) => {
        const event = eventMap.get(row.rekomendasiEventId);
        return {
          eventId: row.rekomendasiEventId,
          eventName: event?.namaEvent || `Event #${row.rekomendasiEventId}`,
          organizerName: event?.user?.name || event?.penyelenggara || 'Tanpa penyelenggara',
          transactions: row._count,
          tickets: row._sum.quantity || 0,
          revenue: toNumber(row._sum.totalAmount),
          adminFee: toNumber(row._sum.adminFee),
        };
      })
      .sort((a, b) => b.adminFee - a.adminFee),
  };
};

// GET /api/admin-fee — ringkasan + rekap per status, per bulan, dan per event.
router.get('/', async (req, res) => {
  try {
    const where = buildWhere(req);
    // Ringkasan selalu dihitung lintas status supaya kartu "sudah masuk" vs
    // "potensi hilang" tetap terbaca walau daftar transaksi sedang difilter.
    const { status: _ignoredStatus, OR: _ignoredSearch, ...scope } = where;
    const rawFilter = buildRawFilter(req);

    const [byStatus, paidTotals, paidByEvent, monthly, daily, events, ticket] = await Promise.all([
      prisma.votingPurchase.groupBy({
        by: ['status'],
        where: scope,
        _sum: { adminFee: true, voteCount: true, totalAmount: true },
        _count: true,
      }),
      prisma.votingPurchase.aggregate({
        where: { ...scope, status: 'PAID' },
        _sum: { adminFee: true, voteCount: true, totalAmount: true, qrisFee: true, grossAmount: true },
        _count: true,
      }),
      prisma.votingPurchase.groupBy({
        by: ['rekomendasiEventId'],
        where: { ...scope, status: 'PAID' },
        _sum: { adminFee: true, voteCount: true, totalAmount: true },
        _count: true,
      }),
      // Rekap bulanan memakai paid_at (kapan uang benar-benar masuk), dengan
      // fallback created_at untuk baris lama yang paid_at-nya tidak terisi.
      prisma.$queryRaw`
        SELECT DATE_FORMAT(COALESCE(paid_at, created_at), '%Y-%m') AS period,
               COUNT(*) AS transactions,
               SUM(vote_count) AS votes,
               SUM(admin_fee) AS adminFee,
               SUM(total_amount) AS revenue
        FROM voting_purchases
        WHERE ${rawFilter}
        GROUP BY period
        ORDER BY period ASC`,
      prisma.$queryRaw`
        SELECT DATE_FORMAT(COALESCE(paid_at, created_at), '%Y-%m-%d') AS period,
               COUNT(*) AS transactions,
               SUM(vote_count) AS votes,
               SUM(admin_fee) AS adminFee
        FROM voting_purchases
        WHERE ${rawFilter}
        GROUP BY period
        ORDER BY period DESC
        LIMIT 60`,
      prisma.rekomendasiEvent.findMany({
        where: { votingConfig: { isNot: null } },
        select: {
          id: true,
          namaEvent: true,
          penyelenggara: true,
          user: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      buildTicketRecap(req),
    ]);

    const statusMap = Object.fromEntries(byStatus.map((row) => [row.status, row]));
    const statusFee = (status) => toNumber(statusMap[status]?._sum.adminFee);

    const eventNameMap = new Map(events.map((event) => [event.id, event]));
    const eventBreakdown = paidByEvent
      .map((row) => {
        const event = eventNameMap.get(row.rekomendasiEventId);
        return {
          eventId: row.rekomendasiEventId,
          eventName: event?.namaEvent || `Event #${row.rekomendasiEventId}`,
          organizerName: event?.user?.name || event?.penyelenggara || 'Tanpa penyelenggara',
          transactions: row._count,
          votes: row._sum.voteCount || 0,
          revenue: toNumber(row._sum.totalAmount),
          adminFee: toNumber(row._sum.adminFee),
        };
      })
      .sort((a, b) => b.adminFee - a.adminFee);

    const collectedFee = toNumber(paidTotals._sum.adminFee);
    const paidVotes = paidTotals._sum.voteCount || 0;
    const paidTransactions = paidTotals._count;

    const normalizeSeries = (rows) => rows.map((row) => ({
      period: row.period,
      transactions: Number(row.transactions) || 0,
      votes: Number(row.votes) || 0,
      adminFee: toNumber(row.adminFee),
      revenue: toNumber(row.revenue),
    }));

    res.json({
      config: {
        perVote: VOTING_ADMIN_FEE_PER_VOTE,
        maxPerTransaction: VOTING_MAX_ADMIN_FEE,
      },
      summary: {
        // Biaya admin yang sudah benar-benar diterima (transaksi lunas).
        collectedFee,
        paidTransactions,
        paidVotes,
        paidRevenue: toNumber(paidTotals._sum.totalAmount),
        qrisFee: toNumber(paidTotals._sum.qrisFee),
        grossAmount: toNumber(paidTotals._sum.grossAmount),
        avgFeePerTransaction: paidTransactions ? collectedFee / paidTransactions : 0,
        avgFeePerVote: paidVotes ? collectedFee / paidVotes : 0,
        // Checkout yang masih berjalan — belum jadi pendapatan.
        pendingFee: statusFee('PENDING'),
        pendingTransactions: statusMap.PENDING?._count || 0,
        // Checkout gagal/kedaluwarsa — potensi biaya admin yang batal masuk.
        lostFee: statusFee('EXPIRED') + statusFee('CANCELLED'),
        lostTransactions: (statusMap.EXPIRED?._count || 0) + (statusMap.CANCELLED?._count || 0),
      },
      byStatus: PURCHASE_STATUSES.map((status) => ({
        status,
        transactions: statusMap[status]?._count || 0,
        votes: statusMap[status]?._sum.voteCount || 0,
        adminFee: statusFee(status),
      })),
      byMonth: normalizeSeries(monthly),
      byDay: normalizeSeries(daily).reverse(),
      byEvent: eventBreakdown,
      events: events.map((event) => ({ id: event.id, namaEvent: event.namaEvent })),
      // Rekap biaya admin penjualan tiket, plus totalan lintas modul supaya panel
      // bisa menyebut satu angka "pendapatan platform" tanpa menjumlah sendiri.
      ticket,
      combined: {
        collectedFee: collectedFee + ticket.summary.collectedFee,
        pendingFee: statusFee('PENDING') + ticket.summary.pendingFee,
        lostFee: statusFee('EXPIRED') + statusFee('CANCELLED') + ticket.summary.lostFee,
        paidTransactions: paidTransactions + ticket.summary.paidTransactions,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat rekap biaya admin', detail: error.message });
  }
});

// GET /api/admin-fee/transactions — rincian per transaksi (dengan paginasi).
router.get('/transactions', async (req, res) => {
  try {
    const where = buildWhere(req);
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));

    const [purchases, total, pageAgg] = await Promise.all([
      prisma.votingPurchase.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { event: { select: { id: true, namaEvent: true } } },
      }),
      prisma.votingPurchase.count({ where }),
      prisma.votingPurchase.aggregate({
        where: { ...where, status: 'PAID' },
        _sum: { adminFee: true, voteCount: true, totalAmount: true },
        _count: true,
      }),
    ]);

    res.json({
      data: purchases.map((purchase) => ({
        id: purchase.id,
        purchaseCode: purchase.purchaseCode,
        eventId: purchase.rekomendasiEventId,
        eventName: purchase.event?.namaEvent || null,
        buyerName: purchase.buyerName,
        buyerEmail: purchase.buyerEmail,
        buyerPhone: purchase.buyerPhone,
        voteCount: purchase.voteCount,
        status: purchase.status,
        paymentType: purchase.paymentType,
        totalAmount: toNumber(purchase.totalAmount),
        adminFee: toNumber(purchase.adminFee),
        qrisFee: toNumber(purchase.qrisFee),
        grossAmount: toNumber(purchase.grossAmount),
        paidAt: purchase.paidAt,
        createdAt: purchase.createdAt,
      })),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      summary: {
        totalRecords: total,
        paidTransactions: pageAgg._count,
        paidVotes: pageAgg._sum.voteCount || 0,
        collectedFee: toNumber(pageAgg._sum.adminFee),
        paidRevenue: toNumber(pageAgg._sum.totalAmount),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat transaksi biaya admin', detail: error.message });
  }
});

// GET /api/admin-fee/export — unduh rekap sebagai CSV (mengikuti filter aktif).
router.get('/export', async (req, res) => {
  try {
    const where = buildWhere(req);
    const purchases = await prisma.votingPurchase.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 20000,
      include: { event: { select: { namaEvent: true } } },
    });

    const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [
      ['Kode', 'Tanggal Dibuat', 'Tanggal Bayar', 'Event', 'Pembeli', 'Email', 'Telepon', 'Jumlah Vote', 'Status', 'Nilai Vote', 'Biaya Admin', 'Biaya QRIS', 'Total Dibayar'].join(','),
      ...purchases.map((purchase) => [
        escape(purchase.purchaseCode),
        escape(purchase.createdAt?.toISOString()),
        escape(purchase.paidAt?.toISOString() || ''),
        escape(purchase.event?.namaEvent),
        escape(purchase.buyerName),
        escape(purchase.buyerEmail),
        escape(purchase.buyerPhone),
        purchase.voteCount,
        escape(purchase.status),
        toNumber(purchase.totalAmount),
        toNumber(purchase.adminFee),
        toNumber(purchase.qrisFee),
        toNumber(purchase.grossAmount),
      ].join(',')),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rekap-biaya-admin-${Date.now()}.csv"`);
    res.send(`﻿${rows.join('\n')}`);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengekspor rekap biaya admin', detail: error.message });
  }
});

module.exports = router;
