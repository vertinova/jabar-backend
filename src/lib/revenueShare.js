// ==================== PEMAHATAN SALDO PENGDA & DEVELOPER ====================
//
// Satu transaksi dibelah dua kali, dan urutannya yang menjelaskan sisanya:
//
//   1. Saat checkout, `total_amount` dibelah jadi bagian penyelenggara dan bagian
//      Pengda. Kedua angka itu DIBEKUKAN di baris transaksi, sehingga persentase
//      yang berubah di kemudian hari tidak menulis ulang uang yang sudah masuk.
//   2. Bagian Developer DIPAHAT DARI jatah Pengda — bukan tambahan di luarnya —
//      dan sengaja TIDAK dibekukan: ia dihitung ulang dari
//      `developer_share_percent` milik konfigurasi event saat ini. Artinya
//      mengubah persentase developer ikut mengubah pembagian transaksi lama.
//      Itu perilaku yang sudah berjalan sejak awal dan dipertahankan di sini.
//
// Unit kebenarannya adalah SATU TRANSAKSI: developer = round(bruto x persen),
// dibatasi jatah Pengda transaksi itu. Semua total di atasnya (per event, pool
// global, saldo yang boleh dicairkan) dijumlahkan dari angka per transaksi lewat
// SQL yang memakai rumus identik — supaya rincian yang tampil di layar benar-benar
// menjumlah ke totalnya, bukan sekadar mendekati. Kalau pemahatan dilakukan di
// tingkat agregat, selisih pembulatan per baris menumpuk dan panel rincian
// berbeda beberapa rupiah dari saldo yang dicairkan.
//
// Biaya admin & biaya QRIS TIDAK masuk pool mana pun (ditagihkan di atas harga);
// keduanya hanya dibawa serta agar panel bisa menunjukkan bruto vs yang dibagi.

const { Prisma } = require('@prisma/client');

// Transaksi yang uangnya sudah benar-benar diterima. Tiket USED = penontonnya
// sudah masuk gerbang, jadi tetap terhitung sebagai pendapatan.
const VOTING_EARNED_STATUSES = ['PAID'];
const TICKET_EARNED_STATUSES = ['PAID', 'USED'];

const SOURCES = ['VOTING', 'TICKET'];
const SOURCE_LABEL = { VOTING: 'E-Voting', TICKET: 'E-Ticketing' };

const toNumber = (value) => (value === null || value === undefined ? 0 : Number(value));
const clampPercent = (value) => Math.min(Math.max(Number(value) || 0, 0), 100);

// Kembaran JavaScript dari rumus SQL di bawah. Dipakai untuk menghitung ulang
// satu baris tanpa menyentuh database (mis. pratinjau dampak ubah persentase).
const carveDeveloperShare = (grossAmount, pengdaShareAmount, developerSharePercent) => {
  const pengdaShare = Math.max(0, toNumber(pengdaShareAmount));
  const developerShare = Math.min(
    pengdaShare,
    Math.round((toNumber(grossAmount) * clampPercent(developerSharePercent)) / 100)
  );
  return { developerShare, pengdaNetShare: pengdaShare - developerShare };
};

// Rumus pemahatan dalam SQL, satu per baris transaksi.
const carveSql = (grossCol, pengdaCol, percentCol) => Prisma.sql`
  LEAST(${pengdaCol}, ROUND(${grossCol} * LEAST(GREATEST(${percentCol}, 0), 100) / 100))`;

const VOTING_CARVE = carveSql(
  Prisma.sql`vp.total_amount`,
  Prisma.sql`vp.pengda_share_amount`,
  Prisma.sql`vc.developer_share_percent`
);
const TICKET_CARVE = carveSql(
  Prisma.sql`t.total_amount`,
  Prisma.sql`t.pengda_share_amount`,
  Prisma.sql`tc.developer_share_percent`
);

// Hanya event yang konfigurasinya DISETUJUI yang membentuk pool — sama dengan
// aturan yang dipakai validasi pencairan sebelum panel ini ada.
const votingConditions = ({ from, to, eventId, search } = {}) => {
  const list = [
    Prisma.sql`vp.status IN (${Prisma.join(VOTING_EARNED_STATUSES)})`,
    Prisma.sql`vc.approval_status = 'APPROVED'`,
  ];
  if (eventId) list.push(Prisma.sql`vp.rekomendasi_event_id = ${eventId}`);
  if (from) list.push(Prisma.sql`COALESCE(vp.paid_at, vp.created_at) >= ${from}`);
  if (to) list.push(Prisma.sql`COALESCE(vp.paid_at, vp.created_at) <= ${to}`);
  if (search) {
    const like = `%${search}%`;
    list.push(Prisma.sql`(vp.buyer_name LIKE ${like} OR vp.buyer_email LIKE ${like} OR vp.purchase_code LIKE ${like} OR e.namaEvent LIKE ${like})`);
  }
  return Prisma.join(list, ' AND ');
};

const ticketConditions = ({ from, to, eventId, search } = {}) => {
  const list = [
    Prisma.sql`t.status IN (${Prisma.join(TICKET_EARNED_STATUSES)})`,
    Prisma.sql`tc.approval_status = 'APPROVED'`,
  ];
  if (eventId) list.push(Prisma.sql`t.rekomendasi_event_id = ${eventId}`);
  if (from) list.push(Prisma.sql`COALESCE(t.paid_at, t.created_at) >= ${from}`);
  if (to) list.push(Prisma.sql`COALESCE(t.paid_at, t.created_at) <= ${to}`);
  if (search) {
    const like = `%${search}%`;
    list.push(Prisma.sql`(t.buyer_name LIKE ${like} OR t.buyer_email LIKE ${like} OR t.order_code LIKE ${like} OR e.namaEvent LIKE ${like})`);
  }
  return Prisma.join(list, ' AND ');
};

// ── Rekap per event ─────────────────────────────────────────────────────────
// Satu baris per (event, sumber). Pemahatan developer tetap per transaksi
// (SUM(LEAST(...))), jadi total di sini identik dengan jumlah baris rinciannya.

const votingByEventSql = (filter) => Prisma.sql`
  SELECT 'VOTING' AS source,
         vp.rekomendasi_event_id AS eventId,
         e.namaEvent AS eventName,
         COALESCE(u.name, e.penyelenggara) AS organizerName,
         vc.organizer_share_percent AS organizerSharePercent,
         vc.pengda_share_percent AS pengdaSharePercent,
         vc.developer_share_percent AS developerSharePercent,
         COUNT(*) AS transactions,
         COALESCE(SUM(vp.vote_count), 0) AS units,
         COALESCE(SUM(vp.total_amount), 0) AS grossRevenue,
         COALESCE(SUM(vp.organizer_share_amount), 0) AS organizerShare,
         COALESCE(SUM(vp.pengda_share_amount), 0) AS pengdaGross,
         COALESCE(SUM(${VOTING_CARVE}), 0) AS developerShare,
         COALESCE(SUM(vp.admin_fee), 0) AS adminFee,
         COALESCE(SUM(vp.qris_fee), 0) AS qrisFee,
         MAX(COALESCE(vp.paid_at, vp.created_at)) AS lastAt
  FROM voting_purchases vp
  JOIN event_voting_configs vc ON vc.rekomendasi_event_id = vp.rekomendasi_event_id
  JOIN rekomendasi_events e ON e.id = vp.rekomendasi_event_id
  LEFT JOIN users u ON u.id = e.userId
  WHERE ${votingConditions(filter)}
  GROUP BY vp.rekomendasi_event_id, e.namaEvent, u.name, e.penyelenggara,
           vc.organizer_share_percent, vc.pengda_share_percent, vc.developer_share_percent`;

const ticketByEventSql = (filter) => Prisma.sql`
  SELECT 'TICKET' AS source,
         t.rekomendasi_event_id AS eventId,
         e.namaEvent AS eventName,
         COALESCE(u.name, e.penyelenggara) AS organizerName,
         tc.organizer_share_percent AS organizerSharePercent,
         tc.pengda_share_percent AS pengdaSharePercent,
         tc.developer_share_percent AS developerSharePercent,
         COUNT(*) AS transactions,
         COALESCE(SUM(t.quantity), 0) AS units,
         COALESCE(SUM(t.total_amount), 0) AS grossRevenue,
         COALESCE(SUM(t.organizer_share_amount), 0) AS organizerShare,
         COALESCE(SUM(t.pengda_share_amount), 0) AS pengdaGross,
         COALESCE(SUM(${TICKET_CARVE}), 0) AS developerShare,
         COALESCE(SUM(t.admin_fee), 0) AS adminFee,
         COALESCE(SUM(t.qris_fee), 0) AS qrisFee,
         MAX(COALESCE(t.paid_at, t.created_at)) AS lastAt
  FROM ticket_orders t
  JOIN event_ticket_configs tc ON tc.rekomendasi_event_id = t.rekomendasi_event_id
  JOIN rekomendasi_events e ON e.id = t.rekomendasi_event_id
  LEFT JOIN users u ON u.id = e.userId
  WHERE ${ticketConditions(filter)}
  GROUP BY t.rekomendasi_event_id, e.namaEvent, u.name, e.penyelenggara,
           tc.organizer_share_percent, tc.pengda_share_percent, tc.developer_share_percent`;

const normalizeEventRow = (row) => {
  const pengdaGross = toNumber(row.pengdaGross);
  const developerShare = toNumber(row.developerShare);
  const developerSharePercent = toNumber(row.developerSharePercent);
  const pengdaSharePercent = toNumber(row.pengdaSharePercent);
  return {
    source: row.source,
    sourceLabel: SOURCE_LABEL[row.source] || row.source,
    eventId: Number(row.eventId),
    eventName: row.eventName || `Event #${row.eventId}`,
    organizerName: row.organizerName || 'Tanpa penyelenggara',
    organizerSharePercent: toNumber(row.organizerSharePercent),
    pengdaSharePercent,
    developerSharePercent,
    // Sisa persentase Pengda setelah jatah developer dipahat darinya.
    pengdaNetSharePercent: Math.max(0, pengdaSharePercent - developerSharePercent),
    transactions: Number(row.transactions) || 0,
    units: Number(row.units) || 0,
    grossRevenue: toNumber(row.grossRevenue),
    organizerShare: toNumber(row.organizerShare),
    pengdaGross,
    developerShare,
    pengdaNetShare: Math.max(0, pengdaGross - developerShare),
    adminFee: toNumber(row.adminFee),
    qrisFee: toNumber(row.qrisFee),
    lastAt: row.lastAt || null,
  };
};

// Rekap per (event, sumber). `filter` = { from, to, eventId, search, source }.
const loadShareByEvent = async (db, filter = {}) => {
  const source = SOURCES.includes(filter.source) ? filter.source : null;
  const [voting, ticket] = await Promise.all([
    source === 'TICKET' ? [] : db.$queryRaw(votingByEventSql(filter)),
    source === 'VOTING' ? [] : db.$queryRaw(ticketByEventSql(filter)),
  ]);
  return [...voting, ...ticket].map(normalizeEventRow);
};

// Gabungkan baris per-sumber menjadi satu baris per event, dengan rincian
// sumbernya tetap terbawa supaya panel bisa membuka "dari vote berapa, dari
// tiket berapa" tanpa permintaan kedua.
const mergeEventRows = (rows) => {
  const merged = new Map();
  for (const row of rows) {
    const current = merged.get(row.eventId) || {
      eventId: row.eventId,
      eventName: row.eventName,
      organizerName: row.organizerName,
      transactions: 0,
      units: 0,
      grossRevenue: 0,
      organizerShare: 0,
      pengdaGross: 0,
      developerShare: 0,
      pengdaNetShare: 0,
      adminFee: 0,
      qrisFee: 0,
      lastAt: null,
      sources: [],
    };
    current.transactions += row.transactions;
    current.units += row.units;
    current.grossRevenue += row.grossRevenue;
    current.organizerShare += row.organizerShare;
    current.pengdaGross += row.pengdaGross;
    current.developerShare += row.developerShare;
    current.pengdaNetShare += row.pengdaNetShare;
    current.adminFee += row.adminFee;
    current.qrisFee += row.qrisFee;
    if (!current.lastAt || (row.lastAt && new Date(row.lastAt) > new Date(current.lastAt))) {
      current.lastAt = row.lastAt;
    }
    current.sources.push(row);
    merged.set(row.eventId, current);
  }
  return [...merged.values()].sort((a, b) => b.pengdaGross - a.pengdaGross);
};

const emptyTotals = () => ({
  transactions: 0,
  units: 0,
  grossRevenue: 0,
  organizerShare: 0,
  pengdaGross: 0,
  developerShare: 0,
  pengdaNetShare: 0,
  adminFee: 0,
  qrisFee: 0,
});

const sumRows = (rows) => rows.reduce((acc, row) => {
  acc.transactions += row.transactions;
  acc.units += row.units;
  acc.grossRevenue += row.grossRevenue;
  acc.organizerShare += row.organizerShare;
  acc.pengdaGross += row.pengdaGross;
  acc.developerShare += row.developerShare;
  acc.pengdaNetShare += row.pengdaNetShare;
  acc.adminFee += row.adminFee;
  acc.qrisFee += row.qrisFee;
  return acc;
}, emptyTotals());

// Pool global Pengda & Developer — inilah angka yang membatasi pencairan.
// Bentuk keluarannya dipertahankan sama dengan computeGlobalPools() lama supaya
// pemanggil yang sudah ada tidak perlu ikut berubah.
const computeSharePools = async (db, filter = {}) => {
  const rows = await loadShareByEvent(db, filter);
  const voting = sumRows(rows.filter((row) => row.source === 'VOTING'));
  const ticket = sumRows(rows.filter((row) => row.source === 'TICKET'));
  const total = sumRows(rows);
  const shape = (totals) => ({
    pengdaGross: totals.pengdaGross,
    developerTotal: totals.developerShare,
    pengdaNet: totals.pengdaNetShare,
  });
  return {
    ...shape(total),
    voting: shape(voting),
    ticket: shape(ticket),
    totals: { all: total, voting, ticket },
    byEvent: rows,
  };
};

// ── Rincian per transaksi ───────────────────────────────────────────────────
// Kolom kedua cabang UNION harus sama persis urutan & jumlahnya.

const votingLedgerSql = (filter) => Prisma.sql`
  SELECT 'VOTING' AS source,
         vp.id AS id,
         vp.purchase_code AS code,
         vp.rekomendasi_event_id AS eventId,
         e.namaEvent AS eventName,
         vp.buyer_name AS buyerName,
         vp.buyer_email AS buyerEmail,
         vp.vote_count AS units,
         vp.status AS status,
         vp.total_amount AS grossAmount,
         vp.organizer_share_amount AS organizerShare,
         vp.pengda_share_amount AS pengdaGross,
         ${VOTING_CARVE} AS developerShare,
         vc.organizer_share_percent AS organizerSharePercent,
         vc.pengda_share_percent AS pengdaSharePercent,
         vc.developer_share_percent AS developerSharePercent,
         vp.admin_fee AS adminFee,
         vp.qris_fee AS qrisFee,
         vp.payment_type AS paymentType,
         COALESCE(vp.paid_at, vp.created_at) AS occurredAt
  FROM voting_purchases vp
  JOIN event_voting_configs vc ON vc.rekomendasi_event_id = vp.rekomendasi_event_id
  JOIN rekomendasi_events e ON e.id = vp.rekomendasi_event_id
  WHERE ${votingConditions(filter)}`;

const ticketLedgerSql = (filter) => Prisma.sql`
  SELECT 'TICKET' AS source,
         t.id AS id,
         t.order_code AS code,
         t.rekomendasi_event_id AS eventId,
         e.namaEvent AS eventName,
         t.buyer_name AS buyerName,
         t.buyer_email AS buyerEmail,
         t.quantity AS units,
         t.status AS status,
         t.total_amount AS grossAmount,
         t.organizer_share_amount AS organizerShare,
         t.pengda_share_amount AS pengdaGross,
         ${TICKET_CARVE} AS developerShare,
         tc.organizer_share_percent AS organizerSharePercent,
         tc.pengda_share_percent AS pengdaSharePercent,
         tc.developer_share_percent AS developerSharePercent,
         t.admin_fee AS adminFee,
         t.qris_fee AS qrisFee,
         t.payment_type AS paymentType,
         COALESCE(t.paid_at, t.created_at) AS occurredAt
  FROM ticket_orders t
  JOIN event_ticket_configs tc ON tc.rekomendasi_event_id = t.rekomendasi_event_id
  JOIN rekomendasi_events e ON e.id = t.rekomendasi_event_id
  WHERE ${ticketConditions(filter)}`;

const ledgerUnionSql = (filter) => {
  const source = SOURCES.includes(filter.source) ? filter.source : null;
  if (source === 'VOTING') return votingLedgerSql(filter);
  if (source === 'TICKET') return ticketLedgerSql(filter);
  return Prisma.sql`${votingLedgerSql(filter)} UNION ALL ${ticketLedgerSql(filter)}`;
};

const normalizeLedgerRow = (row) => {
  const pengdaGross = toNumber(row.pengdaGross);
  const developerShare = toNumber(row.developerShare);
  const pengdaSharePercent = toNumber(row.pengdaSharePercent);
  const developerSharePercent = toNumber(row.developerSharePercent);
  return {
    source: row.source,
    sourceLabel: SOURCE_LABEL[row.source] || row.source,
    id: Number(row.id),
    // id transaksi unik per tabel, jadi kunci baris harus menyertakan sumbernya.
    key: `${row.source}-${row.id}`,
    code: row.code,
    eventId: Number(row.eventId),
    eventName: row.eventName || `Event #${row.eventId}`,
    buyerName: row.buyerName,
    buyerEmail: row.buyerEmail,
    units: Number(row.units) || 0,
    status: row.status,
    grossAmount: toNumber(row.grossAmount),
    organizerShare: toNumber(row.organizerShare),
    pengdaGross,
    developerShare,
    pengdaNetShare: Math.max(0, pengdaGross - developerShare),
    organizerSharePercent: toNumber(row.organizerSharePercent),
    pengdaSharePercent,
    developerSharePercent,
    pengdaNetSharePercent: Math.max(0, pengdaSharePercent - developerSharePercent),
    adminFee: toNumber(row.adminFee),
    qrisFee: toNumber(row.qrisFee),
    paymentType: row.paymentType || null,
    occurredAt: row.occurredAt || null,
  };
};

// Daftar transaksi lintas modul, terurut waktu uang masuk. `limit`/`offset`
// diterapkan setelah UNION supaya paginasinya benar-benar lintas sumber.
const loadShareLedger = async (db, filter = {}, { limit = 25, offset = 0 } = {}) => {
  // LIMIT/OFFSET ditempel sebagai literal, bukan parameter: sebagian versi MySQL
  // menolak placeholder di posisi ini. Aman karena keduanya dipaksa jadi bilangan
  // bulat non-negatif dulu — tidak ada teks pemanggil yang lolos ke query.
  const take = Prisma.raw(String(Math.max(1, Math.trunc(Number(limit) || 25))));
  const skip = Prisma.raw(String(Math.max(0, Math.trunc(Number(offset) || 0))));
  const rows = await db.$queryRaw(Prisma.sql`
    SELECT * FROM (${ledgerUnionSql(filter)}) AS ledger
    ORDER BY ledger.occurredAt DESC, ledger.source ASC, ledger.id DESC
    LIMIT ${take} OFFSET ${skip}`);
  return rows.map(normalizeLedgerRow);
};

const countShareLedger = async (db, filter = {}) => {
  const rows = await db.$queryRaw(Prisma.sql`
    SELECT COUNT(*) AS total FROM (${ledgerUnionSql(filter)}) AS ledger`);
  return Number(rows[0]?.total) || 0;
};

module.exports = {
  SOURCES,
  SOURCE_LABEL,
  toNumber,
  carveDeveloperShare,
  loadShareByEvent,
  mergeEventRows,
  sumRows,
  computeSharePools,
  loadShareLedger,
  countShareLedger,
};
