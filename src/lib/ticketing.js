// ==================== INTI LOGIKA E-TICKETING ====================
//
// Dua hal yang menjelaskan sisanya:
//
// 1. Kuota dipesan saat pesanan DIBUAT, bukan saat dibayar. Kalau tidak, dua orang
//    bisa membayar kursi terakhir yang sama. Konsekuensinya: setiap pesanan yang
//    berakhir tanpa pembayaran wajib melepaskan kuotanya kembali — dan itulah yang
//    dikerjakan jalur pembatalan, webhook gagal/kedaluwarsa, dan penyapu berkala.
//
// 2. Setiap pembatalan melepas DUA hitungan: `sold_count` milik konfigurasi acara
//    dan `sold_count` milik jenis tiket yang dipilih. Melupakan yang kedua membuat
//    kuota jenis menyusut permanen setiap kali seseorang membuka QRIS lalu
//    menutupnya.
//
// Kuota bernilai `null` berarti tanpa batas; `0` berarti benar-benar nol.
const crypto = require('crypto');

// Biaya admin ditagihkan DI ATAS harga tiket dan tidak masuk pool bagi hasil mana
// pun — ia pendapatan platform, dibekukan di kolom `admin_fee` saat checkout dibuat.
const TICKET_ADMIN_FEE_PER_TICKET = 1000;

// Batas pembelian jalur publik: 5 tiket per alamat email per event, dihitung dari
// pesanan PENDING + PAID + USED. Loket OTS tidak terkena batas ini.
const MAX_TICKETS_PER_EMAIL_PER_EVENT = 5;
const MAX_TICKETS_PER_ORDER = 5;
const MAX_TICKETS_PER_OTS_ORDER = 50;

// Alamat cadangan untuk penjualan loket tanpa email pembeli. Bukan alamat yang
// bisa dikirimi surat — ia hanya mengisi kolom wajib, jadi setiap jalur pengiriman
// wajib memeriksanya dulu ketimbang menembak SMTP ke domain yang tidak ada.
const PLACEHOLDER_EMAIL_DOMAIN = '@tiket.forbasi.local';
const isPlaceholderEmail = (value) => String(value || '').toLowerCase().endsWith(PLACEHOLDER_EMAIL_DOMAIN);

// QRIS Midtrans membatasi satu transaksi.
const QRIS_MAX_TRANSACTION = 10000000;

// Jendela checkout dibuat pendek supaya QRIS telantar cepat kedaluwarsa; pembeli
// yang kembali tinggal membuat pesanan baru.
const CHECKOUT_EXPIRY_SECONDS = (Number(process.env.TICKET_CHECKOUT_EXPIRY_MINUTES) || 15) * 60;

// Status yang dianggap masih menahan kuota.
const QUOTA_HOLDING_STATUSES = ['PENDING', 'PAID', 'USED'];

const ORDER_STATUSES = ['PENDING', 'PAID', 'USED', 'CANCELLED', 'EXPIRED'];

const decimalToNumber = (value) => (value === null || value === undefined ? 0 : Number(value));

const toId = (value) => {
  const id = Number.parseInt(value, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
};

// Kuota: null/'' = tanpa batas. Angka negatif ditolak jadi null supaya tidak
// pernah tersimpan sebagai batas yang mustahil dipenuhi.
const parseQuota = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

const normalizeMoney = (value) => Math.max(0, Math.round(Number(value) || 0));

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = (value) => EMAIL_REGEX.test(String(value || '').trim());

// Kode pesanan dipakai pembeli untuk membuka kembali dan membatalkan pesanannya;
// kode tiket (satu per penonton) yang dipindai di gerbang. Keduanya dari
// crypto.randomBytes, bukan urutan yang bisa ditebak.
const generateOrderCode = () => {
  const random = crypto.randomBytes(10).toString('hex').toUpperCase();
  return `TKT-${random.slice(0, 8)}-${random.slice(8)}`;
};

const generateTicketCode = () => {
  const random = crypto.randomBytes(10).toString('hex').toUpperCase();
  return `TIX-${random.slice(0, 8)}-${random.slice(8)}`;
};

const normalizeCode = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase().replace(/[\s\u200B-\u200D\uFEFF]+/g, '');
};

// Biaya admin: tarif tetap per tiket. Tiket gratis tidak dipungut biaya admin —
// kalau tidak, pembeli tiket Rp0 tetap harus membayar dan e-ticket gratis jadi
// mustahil dibagikan.
const calculateTicketAdminFee = (totalAmount, quantity) => {
  const amount = Number(totalAmount) || 0;
  const tickets = Number.parseInt(quantity, 10) || 0;
  if (amount <= 0 || tickets <= 0) return 0;
  return TICKET_ADMIN_FEE_PER_TICKET * tickets;
};

// Bagi hasil dihitung dari harga tiket saja — bukan termasuk biaya admin/QRIS.
const calculateTicketRevenueSplit = (totalAmount, organizerSharePercent, pengdaSharePercent) => {
  const amount = normalizeMoney(totalAmount);
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

// Bagian Developer dipahat dari jatah Pengda (bukan tambahan di luarnya), persis
// seperti modul voting. Rumusnya tinggal satu salinan di lib/revenueShare —
// dulu ada tiga, dan tiga salinan rumus uang adalah tiga peluang untuk berbeda.
const splitPengdaDeveloper = (grossRevenue, pengdaShareAmount, developerSharePercent) => {
  const { carveDeveloperShare } = require('./revenueShare');
  return carveDeveloperShare(grossRevenue, pengdaShareAmount, developerSharePercent);
};

const isSalesWindowOpen = (config, now = new Date()) => {
  if (config.salesStartDate && now < new Date(config.salesStartDate)) return false;
  if (config.salesEndDate && now > new Date(config.salesEndDate)) return false;
  return true;
};

// Alasan penjualan tertutup, dalam bahasa yang bisa langsung ditampilkan.
// Mengembalikan null bila penjualan terbuka.
const getSalesClosedReason = (event, config, now = new Date()) => {
  if (!event || event.status !== 'DISETUJUI') return 'Tiket belum tersedia untuk event ini';
  if (!config || !config.enabled) return 'Penjualan tiket belum dibuka';
  if (config.approvalStatus !== 'APPROVED') return 'Tiket belum disetujui FORBASI Pusat';
  if (config.salesStartDate && now < new Date(config.salesStartDate)) {
    return 'Penjualan tiket belum dimulai';
  }
  if (config.salesEndDate && now > new Date(config.salesEndDate)) {
    return 'Penjualan tiket sudah ditutup';
  }
  return null;
};

const remainingQuota = (quota, soldCount) => {
  if (quota === null || quota === undefined) return null; // tanpa batas
  return Math.max(0, quota - (soldCount || 0));
};

// ==================== PEMESANAN & PELEPASAN KUOTA ====================
//
// Pemesanan memakai satu UPDATE bersyarat (`updateMany` dengan filter kuota di
// dalamnya), bukan baca-lalu-tulis: dua pembeli yang menekan tombol pada detik
// yang sama tidak bisa sama-sama lolos karena syarat kuotanya dievaluasi oleh
// database saat menulis.

// Pesan kuota konfigurasi acara. `enforceWindow` dimatikan untuk loket OTS yang
// justru buka di hari-H, sering setelah penjualan daring ditutup.
const reserveConfigQuota = async (tx, configId, quantity, { enforceWindow = true } = {}) => {
  const now = new Date();
  const config = await tx.eventTicketConfig.findUnique({
    where: { id: configId },
    select: {
      id: true,
      enabled: true,
      approvalStatus: true,
      quota: true,
      soldCount: true,
      salesStartDate: true,
      salesEndDate: true,
    },
  });
  if (!config) throw new Error('Konfigurasi tiket tidak ditemukan');
  if (!config.enabled || config.approvalStatus !== 'APPROVED') {
    throw new Error('Penjualan tiket belum aktif');
  }
  if (enforceWindow && !isSalesWindowOpen(config, now)) {
    throw new Error('Di luar jendela penjualan tiket');
  }

  // Prisma tidak bisa membandingkan dua kolom di `where`, jadi syarat
  // "sold_count + quantity <= quota" ditulis ulang sebagai
  // "sold_count <= quota - quantity" memakai nilai quota yang barusan dibaca.
  // Batasnya tetap dievaluasi database saat menulis, sehingga dua pembeli yang
  // menekan tombol bersamaan tidak bisa sama-sama lolos.
  const filter = { id: configId, enabled: true, approvalStatus: 'APPROVED' };
  if (config.quota !== null) filter.soldCount = { lte: config.quota - quantity };

  const updated = await tx.eventTicketConfig.updateMany({
    where: filter,
    data: { soldCount: { increment: quantity } },
  });

  if (updated.count === 0) {
    throw new Error('Kuota tiket tidak mencukupi');
  }
};

// Pesan kuota jenis tiket (hitungan kedua yang wajib ikut dilepas saat batal).
const reserveTypeQuota = async (tx, ticketTypeId, quantity) => {
  const type = await tx.ticketType.findUnique({
    where: { id: ticketTypeId },
    select: { id: true, isActive: true, quota: true, soldCount: true, name: true },
  });
  if (!type) throw new Error('Jenis tiket tidak ditemukan');
  if (!type.isActive) throw new Error(`Jenis tiket "${type.name}" sedang tidak dijual`);

  const filter = { id: ticketTypeId, isActive: true };
  if (type.quota !== null) {
    filter.soldCount = { lte: type.quota - quantity };
  }

  const updated = await tx.ticketType.updateMany({
    where: filter,
    data: { soldCount: { increment: quantity } },
  });

  if (updated.count === 0) {
    throw new Error(`Kuota jenis tiket "${type.name}" tidak mencukupi`);
  }
};

// Satu-satunya pelepas kuota. Dipakai jalur pembatalan pembeli, webhook
// gagal/kedaluwarsa, penyapu berkala, dan pembatalan manual panitia — supaya
// tidak ada jalur yang lupa melepas salah satu dari dua hitungan.
const releaseOrderQuota = async (tx, order) => {
  const quantity = Number(order.quantity) || 0;
  if (quantity <= 0) return;

  await tx.eventTicketConfig.update({
    where: { id: order.configId },
    data: { soldCount: { decrement: quantity } },
  });

  if (order.ticketTypeId) {
    await tx.ticketType.update({
      where: { id: order.ticketTypeId },
      data: { soldCount: { decrement: quantity } },
    });
  }

  // Jaga-jaga terhadap baris lama yang sold_count-nya sempat melenceng: jangan
  // biarkan hitungan jatuh di bawah nol.
  await tx.eventTicketConfig.updateMany({
    where: { id: order.configId, soldCount: { lt: 0 } },
    data: { soldCount: 0 },
  });
  if (order.ticketTypeId) {
    await tx.ticketType.updateMany({
      where: { id: order.ticketTypeId, soldCount: { lt: 0 } },
      data: { soldCount: 0 },
    });
  }
};

// Batalkan pesanan sekaligus lepaskan kuotanya. Idempoten: pesanan yang sudah
// berstatus akhir dilewati, jadi webhook ganda maupun penyapu yang berpapasan
// dengan pembatalan manual tidak pernah melepas kuota dua kali.
const cancelOrderAndReleaseQuota = async (db, orderId, nextStatus = 'CANCELLED') => {
  return db.$transaction(async (tx) => {
    const order = await tx.ticketOrder.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, quantity: true, configId: true, ticketTypeId: true },
    });
    if (!order) return { released: false };
    if (order.status !== 'PENDING') return { released: false };

    await tx.ticketOrder.update({
      where: { id: order.id },
      data: { status: nextStatus },
    });
    await tx.ticketAttendee.updateMany({
      where: { orderId: order.id },
      data: { status: nextStatus },
    });
    await releaseOrderQuota(tx, order);
    return { released: true };
  });
};

// Tandai pesanan lunas: status pesanan + seluruh tiketnya jadi PAID. Kuota tidak
// disentuh — memang sudah dipesan sejak pesanan dibuat.
const markOrderPaid = async (db, orderId, { paymentType = null } = {}) => {
  return db.$transaction(async (tx) => {
    const order = await tx.ticketOrder.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, paidAt: true },
    });
    if (!order) return { applied: false };
    if (order.status !== 'PENDING') return { applied: false };

    await tx.ticketOrder.update({
      where: { id: order.id },
      data: {
        status: 'PAID',
        paymentType,
        paidAt: order.paidAt || new Date(),
      },
    });
    await tx.ticketAttendee.updateMany({
      where: { orderId: order.id, status: 'PENDING' },
      data: { status: 'PAID' },
    });
    return { applied: true };
  });
};

// Hitung ulang sold_count dari pesanan yang benar-benar menahan kuota. Dipakai
// tombol sinkronisasi ketika angka terjual terasa melenceng.
const syncSoldCount = async (db, configId) => {
  const [configAgg, types] = await Promise.all([
    db.ticketOrder.aggregate({
      where: { configId, status: { in: QUOTA_HOLDING_STATUSES } },
      _sum: { quantity: true },
    }),
    db.ticketType.findMany({ where: { configId }, select: { id: true } }),
  ]);

  const configSold = configAgg._sum.quantity || 0;
  await db.eventTicketConfig.update({
    where: { id: configId },
    data: { soldCount: configSold },
  });

  const typeSold = await Promise.all(
    types.map(async (type) => {
      const agg = await db.ticketOrder.aggregate({
        where: { ticketTypeId: type.id, status: { in: QUOTA_HOLDING_STATUSES } },
        _sum: { quantity: true },
      });
      const sold = agg._sum.quantity || 0;
      await db.ticketType.update({ where: { id: type.id }, data: { soldCount: sold } });
      return { typeId: type.id, soldCount: sold };
    })
  );

  return { configSoldCount: configSold, types: typeSold };
};

// Berapa tiket yang sudah dipegang satu alamat email untuk satu event.
const countTicketsForEmail = async (db, eventId, buyerEmail) => {
  const agg = await db.ticketOrder.aggregate({
    where: {
      rekomendasiEventId: eventId,
      buyerEmail: String(buyerEmail || '').toLowerCase(),
      status: { in: QUOTA_HOLDING_STATUSES },
    },
    _sum: { quantity: true },
  });
  return agg._sum.quantity || 0;
};

// Apakah satu tiket berlaku pada acara/tanggal yang sedang dipindai.
// SINGLE & PASS berlaku sepanjang acara; DAY hanya pada tanggalnya.
const isTicketValidToday = (ticketType, now = new Date()) => {
  if (!ticketType || ticketType.kind !== 'DAY' || !ticketType.validDate) return true;
  const valid = new Date(ticketType.validDate);
  return (
    valid.getFullYear() === now.getFullYear() &&
    valid.getMonth() === now.getMonth() &&
    valid.getDate() === now.getDate()
  );
};

// ==================== SALDO PENJUALAN TIKET ====================
//
// Saldo tiket bergabung dengan saldo vote di satu dompet penyelenggara, jadi
// helper di sini dipanggil dari modul pencairan (voting.routes.js) dan bukan
// dompet terpisah — penyelenggara mencairkan satu angka, bukan dua.
//
// Status yang sudah menghasilkan uang: PAID dan USED. USED artinya penontonnya
// sudah masuk gerbang — uangnya jelas sudah diterima, jadi keliru kalau hilang
// dari saldo begitu tiketnya dipindai.
const TICKET_EARNED_STATUSES = ['PAID', 'USED'];

// Total bagian penyelenggara dari seluruh penjualan tiket event miliknya.
const sumTicketOrganizerShare = async (db, userId) => {
  const agg = await db.ticketOrder.aggregate({
    where: { status: { in: TICKET_EARNED_STATUSES }, event: { userId } },
    _sum: { organizerShareAmount: true },
  });
  return decimalToNumber(agg._sum.organizerShareAmount);
};

// Pool global Pengda & Developer dari penjualan tiket seluruh event yang sudah
// disetujui. Bagian Developer dipahat dari jatah Pengda, persis seperti pool
// voting — dan sejak panel rincian saldo ada, keduanya memakai satu rumus di
// lib/revenueShare yang memahat per transaksi, sehingga total di sini selalu sama
// dengan jumlah baris rincian yang ditampilkan super admin.
const computeTicketGlobalPools = async (db) => {
  const { computeSharePools } = require('./revenueShare');
  const pools = await computeSharePools(db, { source: 'TICKET' });
  return pools.ticket;
};

// Ringkasan penjualan tiket untuk kartu dompet: dipakai agar penyelenggara bisa
// melihat sumbangan tiket terhadap saldonya, terpisah dari vote.
const summarizeTicketSales = async (db, where = {}) => {
  const agg = await db.ticketOrder.aggregate({
    where: { ...where, status: { in: TICKET_EARNED_STATUSES } },
    _sum: {
      quantity: true,
      totalAmount: true,
      adminFee: true,
      qrisFee: true,
      organizerShareAmount: true,
      pengdaShareAmount: true,
    },
    _count: true,
  });
  return {
    grossRevenue: decimalToNumber(agg._sum.totalAmount),
    organizerShare: decimalToNumber(agg._sum.organizerShareAmount),
    pengdaShare: decimalToNumber(agg._sum.pengdaShareAmount),
    adminFee: decimalToNumber(agg._sum.adminFee),
    qrisFee: decimalToNumber(agg._sum.qrisFee),
    soldTickets: agg._sum.quantity || 0,
    paidOrders: agg._count,
  };
};

module.exports = {
  TICKET_ADMIN_FEE_PER_TICKET,
  MAX_TICKETS_PER_EMAIL_PER_EVENT,
  MAX_TICKETS_PER_ORDER,
  MAX_TICKETS_PER_OTS_ORDER,
  QRIS_MAX_TRANSACTION,
  CHECKOUT_EXPIRY_SECONDS,
  QUOTA_HOLDING_STATUSES,
  ORDER_STATUSES,
  decimalToNumber,
  toId,
  parseQuota,
  normalizeMoney,
  isValidEmail,
  generateOrderCode,
  generateTicketCode,
  normalizeCode,
  calculateTicketAdminFee,
  calculateTicketRevenueSplit,
  splitPengdaDeveloper,
  isSalesWindowOpen,
  getSalesClosedReason,
  remainingQuota,
  reserveConfigQuota,
  reserveTypeQuota,
  releaseOrderQuota,
  cancelOrderAndReleaseQuota,
  markOrderPaid,
  syncSoldCount,
  countTicketsForEmail,
  isTicketValidToday,
  PLACEHOLDER_EMAIL_DOMAIN,
  isPlaceholderEmail,
  TICKET_EARNED_STATUSES,
  sumTicketOrganizerShare,
  computeTicketGlobalPools,
  summarizeTicketSales,
};
