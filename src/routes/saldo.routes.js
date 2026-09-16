// ==================== SALDO PENGDA & DEVELOPER (SUPER ADMIN) ====================
//
// Panel ini menjawab tiga pertanyaan yang sebelumnya harus dikira-kira sendiri:
//
//   1. Berapa saldo Pengda dan saldo Developer saat ini, dan berapa yang sudah
//      dicairkan?
//   2. Dari event mana saja saldo itu datang, masing-masing berapa?
//   3. Satu transaksi tertentu menyumbang berapa untuk Pengda dan berapa untuk
//      Developer?
//
// Ketiganya dihitung dari sumber yang sama (lib/revenueShare) dengan pemahatan
// per transaksi, jadi baris rincian benar-benar menjumlah ke total event, dan
// total event menjumlah ke saldo pool yang membatasi pencairan. Kalau ketiganya
// dihitung dengan cara berbeda, panel akan menampilkan tiga angka yang sama-sama
// "benar" tapi tidak cocok satu sama lain — dan itu mustahil direkonsiliasi saat
// uangnya benar-benar ditransfer.
//
// Hanya transaksi LUNAS yang masuk (vote PAID, tiket PAID/USED) dan hanya event
// yang konfigurasinya DISETUJUI — sama dengan aturan yang dipakai validasi
// pencairan. Biaya admin & QRIS ditagihkan di ATAS harga dan tidak masuk pool
// mana pun; keduanya hanya ditampilkan sebagai konteks.

const router = require('express').Router();
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth.middleware');
const { isSuperRole } = require('../lib/roles');
const {
  SOURCES,
  SOURCE_LABEL,
  toNumber,
  loadShareByEvent,
  mergeEventRows,
  sumRows,
  loadShareLedger,
  countShareLedger,
} = require('../lib/revenueShare');

const BENEFICIARIES = ['PENGDA', 'DEVELOPER'];
const BENEFICIARY_LABEL = { PENGDA: 'Pengda', DEVELOPER: 'Developer' };

const canViewSaldo = (req, res, next) => {
  if (isSuperRole(req.user?.role)) return next();
  return res.status(403).json({ error: 'Hanya super admin yang dapat membuka saldo Pengda & Developer' });
};

router.use(authenticate, canViewSaldo);

const toId = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

// `to` diperlakukan inklusif sampai akhir hari, supaya filter "1–31 Juli" ikut
// memuat transaksi yang masuk tanggal 31 sore.
const parseFilter = (query = {}) => {
  const parseDate = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const from = parseDate(query.from);
  const to = parseDate(query.to);
  if (to && String(query.to).length <= 10) to.setHours(23, 59, 59, 999);

  const source = String(query.source || '').toUpperCase();
  return {
    from,
    to,
    eventId: toId(query.eventId),
    source: SOURCES.includes(source) ? source : null,
    search: String(query.search || '').trim() || null,
  };
};

const hasFilter = (filter) => !!(filter.from || filter.to || filter.eventId || filter.source || filter.search);

// Total yang sudah dicatat cair per pool. Penarikan Pengda/Developer selalu
// dicatat langsung berstatus PAID (uangnya sudah ditransfer saat dicatat), jadi
// tidak ada "sedang diproses" untuk dikurangkan seperti pada penyelenggara.
const loadWithdrawnByPool = async () => {
  const rows = await prisma.withdrawalRequest.groupBy({
    by: ['beneficiaryType'],
    where: { beneficiaryType: { in: BENEFICIARIES }, status: 'PAID' },
    _sum: { amount: true },
    _count: true,
  });
  const map = Object.fromEntries(rows.map((row) => [row.beneficiaryType, row]));
  return {
    PENGDA: { withdrawn: toNumber(map.PENGDA?._sum.amount), count: map.PENGDA?._count || 0 },
    DEVELOPER: { withdrawn: toNumber(map.DEVELOPER?._sum.amount), count: map.DEVELOPER?._count || 0 },
  };
};

const serializeWithdrawal = (item) => ({
  id: item.id,
  beneficiaryType: item.beneficiaryType,
  beneficiaryLabel: BENEFICIARY_LABEL[item.beneficiaryType] || item.beneficiaryType,
  amount: toNumber(item.amount),
  bankName: item.bankName,
  accountNumber: item.accountNumber,
  accountHolder: item.accountHolder,
  note: item.note,
  balanceAfter: item.balanceAfter === null || item.balanceAfter === undefined ? null : toNumber(item.balanceAfter),
  recordedBy: item.user?.name || null,
  processedAt: item.processedAt,
  createdAt: item.createdAt,
});

// GET /api/saldo — kartu saldo, rekap per sumber, dan rincian per event.
router.get('/', async (req, res) => {
  try {
    const filter = parseFilter(req.query);

    const [rows, poolRows, withdrawn, withdrawals, eventOptions] = await Promise.all([
      loadShareByEvent(prisma, filter),
      // Pool untuk kartu saldo selalu lintas waktu & lintas event: saldo yang
      // boleh dicairkan tidak boleh ikut menyusut hanya karena panel sedang
      // difilter ke satu bulan.
      hasFilter(filter) ? loadShareByEvent(prisma, {}) : null,
      loadWithdrawnByPool(),
      prisma.withdrawalRequest.findMany({
        where: { beneficiaryType: { in: BENEFICIARIES } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { user: { select: { name: true } } },
      }),
      prisma.rekomendasiEvent.findMany({
        where: {
          OR: [
            { votingConfig: { is: { approvalStatus: 'APPROVED' } } },
            { ticketConfig: { is: { approvalStatus: 'APPROVED' } } },
          ],
        },
        select: { id: true, namaEvent: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const allRows = poolRows || rows;
    const poolTotals = sumRows(allRows);
    const filtered = sumRows(rows);
    const bySource = SOURCES.map((source) => ({
      source,
      label: SOURCE_LABEL[source],
      ...sumRows(rows.filter((row) => row.source === source)),
    }));

    const pools = BENEFICIARIES.map((type) => {
      const total = type === 'DEVELOPER' ? poolTotals.developerShare : poolTotals.pengdaNetShare;
      const paidOut = withdrawn[type].withdrawn;
      return {
        beneficiaryType: type,
        label: BENEFICIARY_LABEL[type],
        // Total bagian sepanjang masa, sebelum dikurangi pencairan.
        total,
        withdrawn: paidOut,
        withdrawalCount: withdrawn[type].count,
        available: Math.max(0, total - paidOut),
      };
    });

    res.json({
      // Saldo pool — tidak terpengaruh filter di layar.
      pools,
      // Angka sesuai filter yang sedang aktif. `pengdaGross` adalah jatah Pengda
      // sebelum bagian developer dipahat; `pengdaNetShare` sesudahnya.
      summary: { ...filtered, filtered: hasFilter(filter) },
      bySource,
      byEvent: mergeEventRows(rows),
      events: eventOptions.map((event) => ({ id: event.id, namaEvent: event.namaEvent })),
      withdrawals: withdrawals.map(serializeWithdrawal),
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat saldo Pengda & Developer', detail: error.message });
  }
});

// GET /api/saldo/transactions — rincian per transaksi, lintas vote & tiket.
router.get('/transactions', async (req, res) => {
  try {
    const filter = parseFilter(req.query);
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));

    const [data, total, rows] = await Promise.all([
      loadShareLedger(prisma, filter, { limit, offset: (page - 1) * limit }),
      countShareLedger(prisma, filter),
      // Total keseluruhan (bukan hanya halaman ini) diambil dari rekap per event
      // dengan filter yang sama, jadi angkanya pasti cocok dengan kartu di atas.
      loadShareByEvent(prisma, filter),
    ]);

    res.json({
      data,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      summary: sumRows(rows),
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat rincian transaksi saldo', detail: error.message });
  }
});

// Rincian satu event tidak punya endpoint sendiri: `?eventId=` pada kedua
// endpoint di atas sudah memberi rekap dan daftar transaksinya, dan itu pula
// yang dipakai tombol "lihat transaksi event ini" di panel.

// GET /api/saldo/export — unduh rincian transaksi sebagai CSV (ikut filter aktif).
router.get('/export', async (req, res) => {
  try {
    const filter = parseFilter(req.query);
    const rows = await loadShareLedger(prisma, filter, { limit: 20000, offset: 0 });

    const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const toIso = (value) => (value ? new Date(value).toISOString() : '');
    const header = [
      'Sumber', 'Kode', 'Tanggal', 'Event', 'Pembeli', 'Email', 'Jumlah', 'Status',
      'Bruto', 'Bagian Penyelenggara', 'Pengda (Kotor)', 'Developer', 'Pengda (Bersih)',
      'Persen Penyelenggara', 'Persen Pengda', 'Persen Developer', 'Biaya Admin', 'Biaya QRIS',
    ].join(',');

    const body = rows.map((row) => [
      escape(row.sourceLabel),
      escape(row.code),
      escape(toIso(row.occurredAt)),
      escape(row.eventName),
      escape(row.buyerName),
      escape(row.buyerEmail),
      row.units,
      escape(row.status),
      row.grossAmount,
      row.organizerShare,
      row.pengdaGross,
      row.developerShare,
      row.pengdaNetShare,
      row.organizerSharePercent,
      row.pengdaSharePercent,
      row.developerSharePercent,
      row.adminFee,
      row.qrisFee,
    ].join(','));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="saldo-pengda-developer-${Date.now()}.csv"`);
    // BOM supaya Excel membaca UTF-8 dengan benar.
    res.send(`﻿${[header, ...body].join('\n')}`);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengekspor rincian saldo', detail: error.message });
  }
});

module.exports = router;
