// ==================== E-TICKETING ====================
//
// Perjalanan satu tiket: penyelenggara menyiapkan konfigurasi & jenis tiket →
// SUPERADMIN menyetujui sekaligus menetapkan persentase bagi hasil → penjualan
// dibuka (daring maupun loket OTS) → pembeli membayar QRIS lewat Midtrans →
// webhook menutup transaksi dan e-ticket dikirim → tiket dipindai di gerbang.
//
// Aturan yang menjelaskan sisanya ada di `lib/ticketing.js`: kuota dipesan saat
// pesanan dibuat (bukan saat dibayar), dan setiap pembatalan wajib melepas dua
// hitungan sekaligus — kuota acara dan kuota jenis tiket.
const router = require('express').Router();
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth.middleware');
const { isAdminLikeRole, isSuperRole } = require('../lib/roles');
const {
  calculateQrisFee,
  createSnapTransaction,
  cancelTransaction,
  getTransactionStatus,
  isMidtransConfigured,
  resolvePaymentStatus,
} = require('../lib/midtrans');
const {
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
  isValidEmail,
  generateOrderCode,
  generateTicketCode,
  normalizeCode,
  calculateTicketAdminFee,
  calculateTicketRevenueSplit,
  splitPengdaDeveloper,
  getSalesClosedReason,
  remainingQuota,
  reserveConfigQuota,
  reserveTypeQuota,
  cancelOrderAndReleaseQuota,
  markOrderPaid,
  syncSoldCount,
  countTicketsForEmail,
  isTicketValidToday,
  PLACEHOLDER_EMAIL_DOMAIN,
} = require('../lib/ticketing');
const { sendTicketEmail, sendTicketEmailSafe } = require('../lib/ticketEmail');
const { isMailerConfigured, verifyMailer } = require('../lib/mailer');

// ==================== HELPER ====================

const optionalAuthenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return next();
  return authenticate(req, res, next);
};

// Penyelenggara mengelola tiket miliknya; ADMIN/SUPERADMIN/DEVELOPER mengelola
// tiket seluruh penyelenggara, sama seperti modul voting.
const canManageTicketing = (req, res, next) => {
  if (isAdminLikeRole(req.user?.role) || req.user?.role === 'PENYELENGGARA') return next();
  return res.status(403).json({ error: 'Akses ditolak' });
};

const requireSuperRole = (req, res, next) => {
  if (isSuperRole(req.user?.role)) return next();
  return res.status(403).json({ error: 'Hanya super admin yang dapat melakukan aksi ini' });
};

const verifyEventOwnership = async (req, eventId) => {
  if (isAdminLikeRole(req.user?.role)) return true;
  const event = await prisma.rekomendasiEvent.findUnique({
    where: { id: eventId },
    select: { userId: true },
  });
  return event?.userId === req.user?.id;
};

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const clampPercent = (value, max = 100) => Math.min(Math.max(Number(value) || 0, 0), max);

const typeInclude = { orderBy: [{ order: 'asc' }, { id: 'asc' }] };

const normalizeType = (type) => (type ? {
  ...type,
  price: decimalToNumber(type.price),
  remainingQuota: remainingQuota(type.quota, type.soldCount),
} : type);

const normalizeConfig = (config) => (config ? {
  ...config,
  price: decimalToNumber(config.price),
  organizerSharePercent: decimalToNumber(config.organizerSharePercent),
  pengdaSharePercent: decimalToNumber(config.pengdaSharePercent),
  developerSharePercent: decimalToNumber(config.developerSharePercent),
  remainingQuota: remainingQuota(config.quota, config.soldCount),
  types: (config.types || []).map(normalizeType),
} : config);

const normalizeOrder = (order) => (order ? {
  ...order,
  unitPrice: decimalToNumber(order.unitPrice),
  totalAmount: decimalToNumber(order.totalAmount),
  adminFee: decimalToNumber(order.adminFee),
  qrisFee: decimalToNumber(order.qrisFee),
  grossAmount: order.grossAmount === null ? null : decimalToNumber(order.grossAmount),
  organizerSharePercent: decimalToNumber(order.organizerSharePercent),
  pengdaSharePercent: decimalToNumber(order.pengdaSharePercent),
  organizerShareAmount: decimalToNumber(order.organizerShareAmount),
  pengdaShareAmount: decimalToNumber(order.pengdaShareAmount),
  ticketType: normalizeType(order.ticketType),
} : order);

// Ambil konfigurasi tiket sebuah event, dibuat otomatis bila belum ada supaya
// panel penyelenggara tidak perlu langkah "aktifkan modul" tersendiri.
const getOrCreateConfig = async (eventId) => {
  const existing = await prisma.eventTicketConfig.findUnique({
    where: { rekomendasiEventId: eventId },
    include: { types: typeInclude },
  });
  if (existing) return existing;
  return prisma.eventTicketConfig.create({
    data: { rekomendasiEventId: eventId },
    include: { types: typeInclude },
  });
};

// Harga satu tiket: dari jenis yang dipilih, atau harga dasar konfigurasi bila
// event belum punya jenis sama sekali. Harga TIDAK PERNAH dikirim dari klien.
const resolveUnitPrice = (config, ticketType) => (ticketType
  ? decimalToNumber(ticketType.price)
  : decimalToNumber(config.price));

// Susun pesanan + tiket per penonton + pemesanan kuota dalam satu transaksi.
const createOrderWithQuota = async ({
  event,
  config,
  ticketType,
  attendees,
  buyer,
  channel,
  userId = null,
  soldById = null,
  note = null,
  enforceWindow = true,
}) => {
  const quantity = attendees.length;
  const unitPrice = resolveUnitPrice(config, ticketType);
  const totalAmount = unitPrice * quantity;
  const adminFee = calculateTicketAdminFee(totalAmount, quantity);
  const revenueSplit = calculateTicketRevenueSplit(
    totalAmount,
    config.organizerSharePercent,
    config.pengdaSharePercent
  );
  const orderCode = generateOrderCode();
  // Tunai di loket langsung lunas; sisanya menunggu pembayaran. Tiket gratis
  // (harga 0) juga langsung lunas — tidak lewat Midtrans sama sekali.
  const paidImmediately = channel === 'OTS_CASH' || totalAmount === 0;

  return prisma.$transaction(async (tx) => {
    await reserveConfigQuota(tx, config.id, quantity, { enforceWindow });
    if (ticketType) await reserveTypeQuota(tx, ticketType.id, quantity);

    const created = await tx.ticketOrder.create({
      data: {
        rekomendasiEventId: event.id,
        configId: config.id,
        ticketTypeId: ticketType?.id || null,
        userId,
        buyerName: buyer.name,
        buyerEmail: buyer.email,
        buyerPhone: buyer.phone || null,
        quantity,
        unitPrice,
        totalAmount,
        adminFee,
        ...revenueSplit,
        orderCode,
        channel,
        soldById,
        note,
        status: paidImmediately ? 'PAID' : 'PENDING',
        paidAt: paidImmediately ? new Date() : null,
        paymentType: channel === 'OTS_CASH' ? 'cash' : null,
      },
    });

    await tx.ticketAttendee.createMany({
      data: attendees.map((attendee) => ({
        orderId: created.id,
        name: attendee.name,
        email: attendee.email || null,
        phone: attendee.phone || null,
        ticketCode: generateTicketCode(),
        status: paidImmediately ? 'PAID' : 'PENDING',
      })),
    });

    return tx.ticketOrder.findUnique({
      where: { id: created.id },
      include: { attendees: true, ticketType: true },
    });
  });
};

// Kirim e-ticket lalu catat waktunya. Tidak pernah melempar error: pembayaran
// yang sudah lunas tidak boleh digagalkan oleh SMTP yang sedang rewel.
const deliverTicketEmail = async (orderId, { overrideEmail = null } = {}) => {
  const order = await prisma.ticketOrder.findUnique({
    where: { id: orderId },
    include: {
      attendees: { orderBy: { id: 'asc' } },
      ticketType: true,
      config: true,
      event: true,
    },
  });
  if (!order) return { sent: false, error: 'Pesanan tidak ditemukan' };

  const result = await sendTicketEmailSafe({
    event: order.event,
    config: order.config,
    order: normalizeOrder(order),
    attendees: order.attendees,
    overrideEmail,
  });

  if (result.sent) {
    await prisma.ticketOrder.update({
      where: { id: order.id },
      data: { emailSentAt: new Date() },
    });
  }
  return result;
};

// Validasi daftar penonton dari body. Nama wajib; email peserta opsional (yang
// wajib adalah email pembeli, karena ke sanalah e-ticket dikirim).
const parseAttendees = (rawAttendees, quantity) => {
  const list = Array.isArray(rawAttendees) ? rawAttendees : [];
  const attendees = list
    .map((item) => ({
      name: String(item?.name || '').trim().slice(0, 191),
      email: String(item?.email || '').trim().toLowerCase().slice(0, 191) || null,
      phone: String(item?.phone || '').trim().slice(0, 191) || null,
    }))
    .filter((item) => item.name);

  if (attendees.length === 0) return { error: 'Data penonton wajib diisi' };
  if (quantity && attendees.length !== quantity) {
    return { error: 'Jumlah data penonton tidak sama dengan jumlah tiket' };
  }
  const invalidEmail = attendees.find((item) => item.email && !isValidEmail(item.email));
  if (invalidEmail) return { error: `Format email penonton "${invalidEmail.name}" tidak valid` };

  return { attendees };
};

// ==================== PUBLIK ====================

// Daftar event yang tiketnya sedang dijual.
router.get('/events', async (req, res) => {
  try {
    const events = await prisma.rekomendasiEvent.findMany({
      where: {
        status: 'DISETUJUI',
        ticketConfig: { is: { enabled: true, approvalStatus: 'APPROVED' } },
      },
      orderBy: [{ tanggalMulai: 'asc' }, { createdAt: 'desc' }],
      include: { ticketConfig: { include: { types: typeInclude } } },
    });

    res.json(events.map((event) => {
      const config = normalizeConfig(event.ticketConfig);
      return {
        id: event.id,
        namaEvent: event.namaEvent,
        jenisEvent: event.jenisEvent,
        lokasi: event.lokasi,
        deskripsi: event.deskripsi,
        poster: event.poster,
        penyelenggara: event.penyelenggara,
        tanggalMulai: event.tanggalMulai,
        tanggalSelesai: event.tanggalSelesai,
        ticket: {
          price: config.price,
          quota: config.quota,
          soldCount: config.soldCount,
          remainingQuota: config.remainingQuota,
          salesStartDate: config.salesStartDate,
          salesEndDate: config.salesEndDate,
          description: config.description,
          closedReason: getSalesClosedReason(event, event.ticketConfig),
          types: config.types
            .filter((type) => type.isActive)
            .map(({ id, name, description, kind, price, quota, soldCount, validDate, remainingQuota: sisa }) => ({
              id, name, description, kind, price, quota, soldCount, validDate, remainingQuota: sisa,
            })),
        },
      };
    }));
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat event tiket', detail: error.message });
  }
});

// Detail satu event beserta jenis tiketnya.
router.get('/events/:eventId', async (req, res) => {
  try {
    const eventId = toId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: 'ID event tidak valid' });

    const event = await prisma.rekomendasiEvent.findUnique({
      where: { id: eventId },
      include: { ticketConfig: { include: { types: typeInclude } } },
    });
    if (!event?.ticketConfig) return res.status(404).json({ error: 'Tiket tidak ditemukan' });

    const config = normalizeConfig(event.ticketConfig);
    res.json({
      id: event.id,
      namaEvent: event.namaEvent,
      jenisEvent: event.jenisEvent,
      lokasi: event.lokasi,
      deskripsi: event.deskripsi,
      poster: event.poster,
      penyelenggara: event.penyelenggara,
      tanggalMulai: event.tanggalMulai,
      tanggalSelesai: event.tanggalSelesai,
      ticket: {
        price: config.price,
        quota: config.quota,
        soldCount: config.soldCount,
        remainingQuota: config.remainingQuota,
        salesStartDate: config.salesStartDate,
        salesEndDate: config.salesEndDate,
        description: config.description,
        adminFeePerTicket: TICKET_ADMIN_FEE_PER_TICKET,
        maxPerEmail: MAX_TICKETS_PER_EMAIL_PER_EVENT,
        closedReason: getSalesClosedReason(event, event.ticketConfig),
        types: config.types.filter((type) => type.isActive),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat tiket event', detail: error.message });
  }
});

// Pemesanan tiket. Terbuka untuk umum; bila pembeli login, tiketnya menempel ke
// akun dan muncul di "Tiket Saya".
router.post('/purchase', optionalAuthenticate, async (req, res) => {
  try {
    const eventId = toId(req.body.eventId);
    const ticketTypeId = toId(req.body.ticketTypeId);
    const buyerName = String(req.body.buyerName || '').trim().slice(0, 191);
    const buyerPhone = String(req.body.buyerPhone || '').trim().slice(0, 191);
    const buyerEmail = String(req.body.buyerEmail || req.user?.email || '').trim().toLowerCase();

    if (!eventId || !buyerName || !buyerEmail) {
      return res.status(400).json({ error: 'Event, nama, dan email pembeli wajib diisi' });
    }
    if (!isValidEmail(buyerEmail)) {
      return res.status(400).json({ error: 'Format email pembeli tidak valid' });
    }

    const quantity = Number.parseInt(req.body.quantity, 10) || 0;
    if (!Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({ error: 'Jumlah tiket minimal 1' });
    }
    if (quantity > MAX_TICKETS_PER_ORDER) {
      return res.status(400).json({ error: `Maksimal ${MAX_TICKETS_PER_ORDER} tiket per transaksi` });
    }

    const parsed = parseAttendees(req.body.attendees, quantity);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const event = await prisma.rekomendasiEvent.findUnique({
      where: { id: eventId },
      include: { ticketConfig: { include: { types: typeInclude } } },
    });
    const config = event?.ticketConfig;
    const closedReason = getSalesClosedReason(event, config);
    if (closedReason) return res.status(400).json({ error: closedReason });

    let ticketType = null;
    if (ticketTypeId) {
      ticketType = config.types.find((type) => type.id === ticketTypeId) || null;
      if (!ticketType) return res.status(400).json({ error: 'Jenis tiket tidak valid' });
      if (!ticketType.isActive) return res.status(400).json({ error: 'Jenis tiket sedang tidak dijual' });
    } else if (config.types.some((type) => type.isActive)) {
      return res.status(400).json({ error: 'Pilih jenis tiket terlebih dahulu' });
    }

    // Batas 5 tiket per alamat email per event, dihitung dari pesanan yang masih
    // menahan kuota (PENDING + PAID + USED).
    const alreadyHeld = await countTicketsForEmail(prisma, eventId, buyerEmail);
    if (alreadyHeld + quantity > MAX_TICKETS_PER_EMAIL_PER_EVENT) {
      return res.status(400).json({
        error: `Satu email maksimal ${MAX_TICKETS_PER_EMAIL_PER_EVENT} tiket per event. Email ini sudah punya ${alreadyHeld}.`,
      });
    }

    const unitPrice = resolveUnitPrice(config, ticketType);
    const totalAmount = unitPrice * quantity;
    const adminFee = calculateTicketAdminFee(totalAmount, quantity);
    const { grossAmount: paymentEstimate } = calculateQrisFee(totalAmount + adminFee);

    if (paymentEstimate > QRIS_MAX_TRANSACTION) {
      return res.status(400).json({
        error: `Total pembayaran tidak boleh melebihi Rp ${QRIS_MAX_TRANSACTION.toLocaleString('id-ID')} per transaksi.`,
      });
    }
    if (totalAmount > 0 && !isMidtransConfigured()) {
      return res.status(503).json({ error: 'Payment gateway belum dikonfigurasi' });
    }

    let order;
    try {
      order = await createOrderWithQuota({
        event,
        config,
        ticketType,
        attendees: parsed.attendees,
        buyer: { name: buyerName, email: buyerEmail, phone: buyerPhone },
        channel: 'ONLINE',
        userId: req.user?.id || null,
      });
    } catch (quotaError) {
      return res.status(400).json({ error: quotaError.message || 'Gagal memesan kuota tiket' });
    }

    // Tiket gratis: langsung lunas, e-ticket dikirim saat itu juga.
    if (totalAmount === 0) {
      const mail = await deliverTicketEmail(order.id);
      return res.status(201).json({
        message: 'Tiket berhasil diterbitkan',
        emailSent: mail.sent,
        emailError: mail.error,
        order: normalizeOrder(order),
      });
    }

    // Kuota sudah dipesan; kalau QRIS gagal dibuat, pesanan dibatalkan dan
    // kuotanya dikembalikan agar kursi tidak tertahan pesanan yang mustahil
    // dibayar.
    try {
      const snapResult = await createSnapTransaction({
        orderId: order.orderCode,
        grossAmount: totalAmount,
        customerName: buyerName,
        customerEmail: buyerEmail,
        customerPhone: buyerPhone,
        adminFee,
        itemDetails: [{
          id: `TIKET-${eventId}`,
          price: unitPrice,
          quantity,
          name: ticketType?.name || 'Tiket Masuk',
        }],
        expiryDurationSeconds: CHECKOUT_EXPIRY_SECONDS,
      });

      const updated = await prisma.ticketOrder.update({
        where: { id: order.id },
        data: {
          midtransOrderId: order.orderCode,
          snapToken: snapResult.token,
          qrisFee: snapResult.qrisFee,
          grossAmount: snapResult.grossAmount,
        },
        include: { attendees: true, ticketType: true },
      });

      return res.status(201).json({
        message: 'Pesanan tiket berhasil dibuat',
        order: {
          ...normalizeOrder(updated),
          paymentAmount: snapResult.grossAmount,
          snapToken: snapResult.token,
          redirectUrl: snapResult.redirectUrl,
        },
      });
    } catch (snapError) {
      await cancelOrderAndReleaseQuota(prisma, order.id, 'CANCELLED');
      return res.status(502).json({
        error: 'Gagal membuat pembayaran QRIS. Kuota tiket sudah dikembalikan, silakan coba lagi.',
        detail: snapError.message,
      });
    }
  } catch (error) {
    res.status(500).json({ error: 'Gagal membuat pesanan tiket', detail: error.message });
  }
});

// Sinkronkan status pembayaran langsung ke Midtrans. Dipakai halaman pembeli
// setelah popup Snap ditutup, tanpa menunggu webhook.
router.post('/payment-status', optionalAuthenticate, async (req, res) => {
  try {
    const orderCode = normalizeCode(req.body.orderCode || req.body.orderId);
    if (!orderCode) return res.status(400).json({ error: 'Kode pesanan wajib diisi' });

    const order = await prisma.ticketOrder.findFirst({
      where: { OR: [{ orderCode }, { midtransOrderId: orderCode }] },
      include: { attendees: { orderBy: { id: 'asc' } }, ticketType: true },
    });
    if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan' });

    if (order.status === 'PENDING' && order.midtransOrderId && isMidtransConfigured()) {
      try {
        const status = await getTransactionStatus(order.midtransOrderId);
        const result = resolvePaymentStatus(status.transaction_status, status.fraud_status);
        if (result === 'success') {
          const { applied } = await markOrderPaid(prisma, order.id, {
            paymentType: status.payment_type || null,
          });
          if (applied) await deliverTicketEmail(order.id);
        } else if (result === 'failed' || result === 'expired') {
          await cancelOrderAndReleaseQuota(
            prisma,
            order.id,
            result === 'expired' ? 'EXPIRED' : 'CANCELLED'
          );
        }
      } catch (statusError) {
        console.error(`[Ticket] Gagal cek status Midtrans ${order.midtransOrderId}:`, statusError.message);
      }
    }

    const fresh = await prisma.ticketOrder.findUnique({
      where: { id: order.id },
      include: { attendees: { orderBy: { id: 'asc' } }, ticketType: true, event: true },
    });

    res.json({
      status: fresh.status,
      order: normalizeOrder(fresh),
      event: { id: fresh.event.id, namaEvent: fresh.event.namaEvent, lokasi: fresh.event.lokasi },
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memeriksa status pembayaran', detail: error.message });
  }
});

// Pembeli menghanguskan pesanannya sendiri (menutup popup QRIS lalu memilih
// "Batalkan"). Dikunci pasangan kode pesanan + salah satu kode tiketnya, supaya
// pembeli tanpa akun tetap bisa membatalkan miliknya sendiri dan orang lain
// tidak bisa membatalkan pesanan yang bukan miliknya.
router.post('/cancel-pending', optionalAuthenticate, async (req, res) => {
  try {
    const orderCode = normalizeCode(req.body.orderCode);
    const ticketCode = normalizeCode(req.body.ticketCode);
    if (!orderCode || !ticketCode) {
      return res.status(400).json({ error: 'Kode pesanan dan kode tiket wajib diisi' });
    }

    const order = await prisma.ticketOrder.findFirst({
      where: { OR: [{ orderCode }, { midtransOrderId: orderCode }] },
      include: { attendees: { select: { ticketCode: true } } },
    });
    if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan' });
    if (!order.attendees.some((attendee) => attendee.ticketCode === ticketCode)) {
      return res.status(403).json({ error: 'Kode tiket tidak cocok dengan pesanan ini' });
    }
    if (order.status !== 'PENDING') {
      return res.status(400).json({ error: `Pesanan sudah berstatus ${order.status} dan tidak bisa dibatalkan` });
    }

    // Batalkan juga di sisi Midtrans supaya QRIS-nya tidak bisa dibayar setelah
    // kuotanya kembali ke kolam.
    if (order.midtransOrderId && isMidtransConfigured()) {
      try {
        await cancelTransaction(order.midtransOrderId);
      } catch (cancelError) {
        console.error(`[Ticket] Gagal membatalkan transaksi Midtrans ${order.midtransOrderId}:`, cancelError.message);
      }
    }

    await cancelOrderAndReleaseQuota(prisma, order.id, 'CANCELLED');
    res.json({ status: 'CANCELLED', message: 'Pesanan dibatalkan dan kuota dikembalikan' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal membatalkan pesanan', detail: error.message });
  }
});

// Buka kembali e-ticket lewat kode pesanan (untuk pembeli tanpa akun).
router.get('/order/:orderCode', async (req, res) => {
  try {
    const orderCode = normalizeCode(req.params.orderCode);
    if (!orderCode) return res.status(400).json({ error: 'Kode pesanan tidak valid' });

    const order = await prisma.ticketOrder.findFirst({
      where: { OR: [{ orderCode }, { midtransOrderId: orderCode }] },
      include: {
        attendees: { orderBy: { id: 'asc' } },
        ticketType: true,
        config: { select: { description: true } },
        event: {
          select: {
            id: true, namaEvent: true, lokasi: true, poster: true,
            tanggalMulai: true, tanggalSelesai: true, penyelenggara: true,
          },
        },
      },
    });
    if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan' });

    res.json({
      order: normalizeOrder(order),
      event: order.event,
      ticketNote: order.config?.description || null,
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat pesanan', detail: error.message });
  }
});

// Tiket milik akun yang sedang login.
router.get('/my', authenticate, async (req, res) => {
  try {
    const orders = await prisma.ticketOrder.findMany({
      where: {
        OR: [
          { userId: req.user.id },
          ...(req.user.email ? [{ buyerEmail: String(req.user.email).toLowerCase() }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        attendees: { orderBy: { id: 'asc' } },
        ticketType: true,
        event: {
          select: {
            id: true, namaEvent: true, lokasi: true, poster: true,
            tanggalMulai: true, tanggalSelesai: true,
          },
        },
      },
    });

    res.json(orders.map((order) => ({ ...normalizeOrder(order), event: order.event })));
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat tiket saya', detail: error.message });
  }
});

// ==================== PANEL PANITIA ====================

router.use('/admin', authenticate, canManageTicketing);

// Event yang bisa dipasangi tiket. Penyelenggara melihat event miliknya yang
// sudah disetujui; admin melihat seluruh event yang layak dipasangi tiket.
//
// Admin sengaja TIDAK dibatasi pada event yang konfigurasinya sudah ada: baris
// konfigurasi baru lahir saat panel membukanya, jadi filter `ticketConfig`
// membuat daftar admin kosong selama belum ada penyelenggara yang menyiapkan
// tiket — dan admin tak punya jalan untuk memulainya sendiri. Event yang sudah
// terlanjur punya konfigurasi tetap ikut walau statusnya berubah, supaya
// penjualan yang sedang berjalan tidak hilang dari panel.
router.get('/admin/events', async (req, res) => {
  try {
    const where = isAdminLikeRole(req.user.role)
      ? { OR: [{ status: 'DISETUJUI' }, { ticketConfig: { isNot: null } }] }
      : { userId: req.user.id, status: 'DISETUJUI' };

    const events = await prisma.rekomendasiEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        ticketConfig: {
          include: {
            types: typeInclude,
            _count: { select: { orders: true } },
          },
        },
        user: { select: { id: true, name: true } },
      },
    });

    res.json(events.map((event) => ({
      id: event.id,
      namaEvent: event.namaEvent,
      lokasi: event.lokasi,
      status: event.status,
      poster: event.poster,
      penyelenggara: event.user?.name || event.penyelenggara || null,
      tanggalMulai: event.tanggalMulai,
      tanggalSelesai: event.tanggalSelesai,
      ticketConfig: normalizeConfig(event.ticketConfig),
    })));
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat event tiket', detail: error.message });
  }
});

router.get('/admin/event/:eventId/config', async (req, res) => {
  try {
    const eventId = toId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: 'ID event tidak valid' });
    if (!(await verifyEventOwnership(req, eventId))) {
      return res.status(403).json({ error: 'Tidak memiliki akses ke event ini' });
    }
    const config = await getOrCreateConfig(eventId);
    res.json(normalizeConfig(config));
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat konfigurasi tiket', detail: error.message });
  }
});

router.put('/admin/event/:eventId/config', async (req, res) => {
  try {
    const eventId = toId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: 'ID event tidak valid' });
    if (!(await verifyEventOwnership(req, eventId))) {
      return res.status(403).json({ error: 'Tidak memiliki akses ke event ini' });
    }

    const existing = await getOrCreateConfig(eventId);
    const enabled = !!req.body.enabled;
    const price = Math.max(0, Math.round(Number(req.body.price) || 0));
    const quota = parseQuota(req.body.quota);
    const salesStartDate = parseDate(req.body.salesStartDate);
    const salesEndDate = parseDate(req.body.salesEndDate);

    if (salesStartDate && salesEndDate && salesEndDate <= salesStartDate) {
      return res.status(400).json({ error: 'Penutupan penjualan harus setelah pembukaan' });
    }
    // Menurunkan kuota di bawah yang sudah terjual akan membuat sisa kuota
    // negatif dan tiket yang sudah dibeli seolah melebihi kapasitas.
    if (quota !== null && quota < existing.soldCount) {
      return res.status(400).json({
        error: `Kuota tidak boleh di bawah jumlah yang sudah terjual (${existing.soldCount}).`,
      });
    }
    if (enabled && existing.approvalStatus !== 'APPROVED') {
      return res.status(400).json({
        error: 'Tiket belum disetujui FORBASI Pusat. Penjualan belum dapat diaktifkan.',
      });
    }

    const config = await prisma.eventTicketConfig.update({
      where: { id: existing.id },
      data: {
        enabled,
        price,
        quota,
        description: String(req.body.description || '').trim() || null,
        salesStartDate,
        salesEndDate,
      },
      include: { types: typeInclude },
    });

    res.json(normalizeConfig(config));
  } catch (error) {
    res.status(500).json({ error: 'Gagal menyimpan konfigurasi tiket', detail: error.message });
  }
});

// SUPERADMIN menyetujui/menolak sekaligus menetapkan persentase bagi hasil.
// Penyelenggara + Pengda wajib berjumlah 100% — sisa setelah bagian penyelenggara
// itulah jatah Pengda, dan bagian Developer nanti dipahat dari jatah Pengda.
router.patch('/admin/event/:eventId/approval', requireSuperRole, async (req, res) => {
  try {
    const eventId = toId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: 'ID event tidak valid' });

    const approvalStatus = String(req.body.approvalStatus || '').toUpperCase();
    if (!['PENDING', 'APPROVED', 'REJECTED'].includes(approvalStatus)) {
      return res.status(400).json({ error: 'Status persetujuan harus PENDING, APPROVED, atau REJECTED' });
    }

    const existing = await getOrCreateConfig(eventId);
    const organizerSharePercent = Number(req.body.organizerSharePercent);
    const pengdaSharePercent = Number(req.body.pengdaSharePercent);

    if (approvalStatus === 'APPROVED') {
      if (
        !Number.isFinite(organizerSharePercent) ||
        !Number.isFinite(pengdaSharePercent) ||
        organizerSharePercent < 0 ||
        pengdaSharePercent < 0 ||
        organizerSharePercent > 100 ||
        pengdaSharePercent > 100 ||
        Math.abs((organizerSharePercent + pengdaSharePercent) - 100) > 0.001
      ) {
        return res.status(400).json({
          error: 'Persentase penyelenggara dan Pengda wajib diisi dan totalnya harus 100%',
        });
      }
    }

    const data = {
      approvalStatus,
      approvalNote: String(req.body.approvalNote || '').trim() || null,
      approvedAt: approvalStatus === 'APPROVED' ? new Date() : null,
    };
    if (approvalStatus === 'APPROVED') {
      data.organizerSharePercent = clampPercent(organizerSharePercent);
      data.pengdaSharePercent = clampPercent(pengdaSharePercent);
    }
    // Persetujuan yang dicabut harus ikut mematikan penjualan; kalau tidak, tiket
    // tetap terjual padahal bagi hasilnya sudah tidak berlaku.
    if (approvalStatus !== 'APPROVED') data.enabled = false;

    const config = await prisma.eventTicketConfig.update({
      where: { id: existing.id },
      data,
      include: { types: typeInclude },
    });

    res.json(normalizeConfig(config));
  } catch (error) {
    res.status(500).json({ error: 'Gagal menyimpan persetujuan tiket', detail: error.message });
  }
});

// Bagian Developer dipahat dari jatah Pengda, jadi tidak boleh melebihinya.
router.patch('/admin/event/:eventId/developer-share', requireSuperRole, async (req, res) => {
  try {
    const eventId = toId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: 'ID event tidak valid' });

    const existing = await prisma.eventTicketConfig.findUnique({
      where: { rekomendasiEventId: eventId },
      select: { id: true, pengdaSharePercent: true },
    });
    if (!existing) return res.status(404).json({ error: 'Konfigurasi tiket tidak ditemukan' });

    const developerSharePercent = clampPercent(req.body.developerSharePercent);
    const pengdaSharePercent = decimalToNumber(existing.pengdaSharePercent);
    if (developerSharePercent > pengdaSharePercent) {
      return res.status(400).json({
        error: `Persentase developer tidak boleh melebihi bagian Pengda (${pengdaSharePercent}%).`,
      });
    }

    const config = await prisma.eventTicketConfig.update({
      where: { id: existing.id },
      data: { developerSharePercent },
      include: { types: typeInclude },
    });
    res.json(normalizeConfig(config));
  } catch (error) {
    res.status(500).json({ error: 'Gagal menyimpan persentase developer', detail: error.message });
  }
});

// ==================== JENIS TIKET ====================

router.get('/admin/event/:eventId/types', async (req, res) => {
  try {
    const eventId = toId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: 'ID event tidak valid' });
    if (!(await verifyEventOwnership(req, eventId))) {
      return res.status(403).json({ error: 'Tidak memiliki akses ke event ini' });
    }
    const config = await getOrCreateConfig(eventId);
    res.json(config.types.map(normalizeType));
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat jenis tiket', detail: error.message });
  }
});

router.post('/admin/event/:eventId/types', async (req, res) => {
  try {
    const eventId = toId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: 'ID event tidak valid' });
    if (!(await verifyEventOwnership(req, eventId))) {
      return res.status(403).json({ error: 'Tidak memiliki akses ke event ini' });
    }

    const name = String(req.body.name || '').trim().slice(0, 191);
    if (!name) return res.status(400).json({ error: 'Nama jenis tiket wajib diisi' });

    const kind = ['SINGLE', 'DAY', 'PASS'].includes(String(req.body.kind || '').toUpperCase())
      ? String(req.body.kind).toUpperCase()
      : 'SINGLE';
    const validDate = kind === 'DAY' ? parseDate(req.body.validDate) : null;
    if (kind === 'DAY' && !validDate) {
      return res.status(400).json({ error: 'Tiket harian wajib punya tanggal berlaku' });
    }

    const config = await getOrCreateConfig(eventId);
    const type = await prisma.ticketType.create({
      data: {
        configId: config.id,
        name,
        description: String(req.body.description || '').trim() || null,
        kind,
        price: Math.max(0, Math.round(Number(req.body.price) || 0)),
        quota: parseQuota(req.body.quota),
        validDate,
        isActive: req.body.isActive === undefined ? true : !!req.body.isActive,
        order: Number.parseInt(req.body.order, 10) || config.types.length,
      },
    });

    res.status(201).json(normalizeType(type));
  } catch (error) {
    res.status(500).json({ error: 'Gagal menambah jenis tiket', detail: error.message });
  }
});

// Cakupan sebuah jenis (kind & tanggal berlaku) sengaja TIDAK bisa disunting
// setelah ada yang membeli: tiket yang sudah terjual akan berpindah keberlakuannya
// tanpa pembelinya tahu. Untuk mengubahnya, hapus dan susun ulang selagi belum
// ada pembeli.
router.put('/admin/types/:typeId', async (req, res) => {
  try {
    const typeId = toId(req.params.typeId);
    if (!typeId) return res.status(400).json({ error: 'ID jenis tiket tidak valid' });

    const type = await prisma.ticketType.findUnique({
      where: { id: typeId },
      include: { config: { select: { rekomendasiEventId: true } } },
    });
    if (!type) return res.status(404).json({ error: 'Jenis tiket tidak ditemukan' });
    if (!(await verifyEventOwnership(req, type.config.rekomendasiEventId))) {
      return res.status(403).json({ error: 'Tidak memiliki akses ke event ini' });
    }

    const quota = parseQuota(req.body.quota);
    if (quota !== null && quota < type.soldCount) {
      return res.status(400).json({
        error: `Kuota jenis tiket tidak boleh di bawah jumlah terjual (${type.soldCount}).`,
      });
    }

    const data = {
      name: String(req.body.name || type.name).trim().slice(0, 191) || type.name,
      description: String(req.body.description || '').trim() || null,
      price: Math.max(0, Math.round(Number(req.body.price) || 0)),
      quota,
      isActive: req.body.isActive === undefined ? type.isActive : !!req.body.isActive,
      order: Number.parseInt(req.body.order, 10) || type.order,
    };

    if (type.soldCount === 0) {
      const kind = ['SINGLE', 'DAY', 'PASS'].includes(String(req.body.kind || '').toUpperCase())
        ? String(req.body.kind).toUpperCase()
        : type.kind;
      const validDate = kind === 'DAY' ? parseDate(req.body.validDate) : null;
      if (kind === 'DAY' && !validDate) {
        return res.status(400).json({ error: 'Tiket harian wajib punya tanggal berlaku' });
      }
      data.kind = kind;
      data.validDate = validDate;
    }

    const updated = await prisma.ticketType.update({ where: { id: typeId }, data });
    res.json(normalizeType(updated));
  } catch (error) {
    res.status(500).json({ error: 'Gagal menyimpan jenis tiket', detail: error.message });
  }
});

router.delete('/admin/types/:typeId', async (req, res) => {
  try {
    const typeId = toId(req.params.typeId);
    if (!typeId) return res.status(400).json({ error: 'ID jenis tiket tidak valid' });

    const type = await prisma.ticketType.findUnique({
      where: { id: typeId },
      include: { config: { select: { rekomendasiEventId: true } } },
    });
    if (!type) return res.status(404).json({ error: 'Jenis tiket tidak ditemukan' });
    if (!(await verifyEventOwnership(req, type.config.rekomendasiEventId))) {
      return res.status(403).json({ error: 'Tidak memiliki akses ke event ini' });
    }

    const soldOrders = await prisma.ticketOrder.count({
      where: { ticketTypeId: typeId, status: { in: QUOTA_HOLDING_STATUSES } },
    });
    if (soldOrders > 0) {
      return res.status(400).json({
        error: 'Jenis tiket ini sudah punya pembeli. Nonaktifkan saja agar tidak dijual lagi.',
      });
    }

    await prisma.ticketType.delete({ where: { id: typeId } });
    res.json({ message: 'Jenis tiket dihapus' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menghapus jenis tiket', detail: error.message });
  }
});

// Susun usulan jenis tiket otomatis: acara beberapa hari mendapat satu tiket per
// tanggal plus satu terusan; acara sehari cukup satu "Tiket Masuk". Harga awal
// disalin dari harga dasar, lalu disesuaikan sendiri.
router.post('/admin/event/:eventId/types/generate', async (req, res) => {
  try {
    const eventId = toId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: 'ID event tidak valid' });
    if (!(await verifyEventOwnership(req, eventId))) {
      return res.status(403).json({ error: 'Tidak memiliki akses ke event ini' });
    }

    const event = await prisma.rekomendasiEvent.findUnique({
      where: { id: eventId },
      select: { tanggalMulai: true, tanggalSelesai: true },
    });
    const config = await getOrCreateConfig(eventId);
    if (config.types.length > 0) {
      return res.status(400).json({ error: 'Jenis tiket sudah ada. Hapus dulu bila ingin disusun ulang.' });
    }

    const basePrice = decimalToNumber(config.price);
    const start = event?.tanggalMulai ? new Date(event.tanggalMulai) : null;
    const end = event?.tanggalSelesai ? new Date(event.tanggalSelesai) : start;

    const days = [];
    if (start && end) {
      const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
      while (cursor <= last && days.length < 30) {
        days.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    const formatDay = (date) => date.toLocaleDateString('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric',
    });

    const proposals = days.length > 1
      ? [
        ...days.map((day, index) => ({
          name: `Tiket Harian ${formatDay(day)}`,
          kind: 'DAY',
          validDate: day,
          price: basePrice,
          order: index,
        })),
        {
          name: 'Tiket Terusan',
          kind: 'PASS',
          validDate: null,
          price: basePrice * days.length,
          order: days.length,
        },
      ]
      : [{ name: 'Tiket Masuk', kind: 'SINGLE', validDate: null, price: basePrice, order: 0 }];

    await prisma.ticketType.createMany({
      data: proposals.map((item) => ({
        configId: config.id,
        name: item.name,
        kind: item.kind,
        validDate: item.validDate,
        price: item.price,
        quota: null,
        order: item.order,
      })),
    });

    const types = await prisma.ticketType.findMany({ where: { configId: config.id }, ...typeInclude });
    res.status(201).json({ message: `${proposals.length} jenis tiket disusun`, types: types.map(normalizeType) });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menyusun jenis tiket', detail: error.message });
  }
});

// ==================== LOKET OTS ====================
//
// Beda perlakuan dari jalur publik: 1–50 tiket per transaksi, batas per email
// tidak berlaku (loket melayani rombongan), dan jendela penjualan tidak
// diberlakukan — loket justru buka di hari-H, sering setelah penjualan daring
// ditutup. Yang tetap wajib: tiketnya dalam keadaan aktif dan sudah disetujui.
router.post('/admin/event/:eventId/ots', async (req, res) => {
  try {
    const eventId = toId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: 'ID event tidak valid' });
    if (!(await verifyEventOwnership(req, eventId))) {
      return res.status(403).json({ error: 'Tidak memiliki akses ke event ini' });
    }

    const method = String(req.body.method || 'CASH').toUpperCase();
    if (!['CASH', 'QRIS'].includes(method)) {
      return res.status(400).json({ error: 'Metode pembayaran harus CASH atau QRIS' });
    }

    const quantity = Number.parseInt(req.body.quantity, 10) || 0;
    if (quantity < 1 || quantity > MAX_TICKETS_PER_OTS_ORDER) {
      return res.status(400).json({ error: `Jumlah tiket loket 1–${MAX_TICKETS_PER_OTS_ORDER} per transaksi` });
    }

    const event = await prisma.rekomendasiEvent.findUnique({
      where: { id: eventId },
      include: { ticketConfig: { include: { types: typeInclude } } },
    });
    const config = event?.ticketConfig;
    if (!config) return res.status(404).json({ error: 'Konfigurasi tiket tidak ditemukan' });
    if (!config.enabled || config.approvalStatus !== 'APPROVED') {
      return res.status(400).json({ error: 'Penjualan tiket belum aktif' });
    }

    const ticketTypeId = toId(req.body.ticketTypeId);
    let ticketType = null;
    if (ticketTypeId) {
      ticketType = config.types.find((type) => type.id === ticketTypeId) || null;
      if (!ticketType) return res.status(400).json({ error: 'Jenis tiket tidak valid' });
    } else if (config.types.some((type) => type.isActive)) {
      return res.status(400).json({ error: 'Pilih jenis tiket terlebih dahulu' });
    }

    const buyerName = String(req.body.buyerName || '').trim().slice(0, 191) || 'Pembeli Loket';
    const buyerPhone = String(req.body.buyerPhone || '').trim().slice(0, 191);
    const rawEmail = String(req.body.buyerEmail || '').trim().toLowerCase();
    if (rawEmail && !isValidEmail(rawEmail)) {
      return res.status(400).json({ error: 'Format email pembeli tidak valid' });
    }

    // Petugas boleh melayani tanpa email — tiketnya cukup dicatat kodenya dan
    // ditunjukkan di layar. Alamat cadangan hanya untuk memenuhi kolom wajib.
    const orderCodeSeed = generateOrderCode().toLowerCase().replace(/[^a-z0-9]/g, '');
    const buyerEmail = rawEmail || `ots-${orderCodeSeed}${PLACEHOLDER_EMAIL_DOMAIN}`;

    // Nama penonton boleh dikosongkan di loket: rombongan sering tidak sempat
    // didata satu per satu, jadi dibuatkan penanda urut yang tetap unik kodenya.
    const parsed = Array.isArray(req.body.attendees) && req.body.attendees.length > 0
      ? parseAttendees(req.body.attendees, quantity)
      : { attendees: Array.from({ length: quantity }, (unused, index) => ({
        name: `${buyerName} #${index + 1}`,
        email: null,
        phone: null,
      })) };
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const unitPrice = resolveUnitPrice(config, ticketType);
    const totalAmount = unitPrice * quantity;
    const adminFee = calculateTicketAdminFee(totalAmount, quantity);

    // Server tanpa kunci Midtrans yang sah menolak QRIS LEBIH AWAL, sebelum kuota
    // dipesan, supaya kursi tidak tertahan pesanan yang mustahil dibayar.
    if (method === 'QRIS' && totalAmount > 0 && !isMidtransConfigured()) {
      return res.status(503).json({
        error: 'Payment gateway belum dikonfigurasi. Layani dengan pembayaran TUNAI.',
      });
    }

    let order;
    try {
      order = await createOrderWithQuota({
        event,
        config,
        ticketType,
        attendees: parsed.attendees,
        buyer: { name: buyerName, email: buyerEmail, phone: buyerPhone },
        channel: method === 'CASH' ? 'OTS_CASH' : 'OTS_QRIS',
        soldById: req.user.id,
        note: String(req.body.note || '').trim() || null,
        enforceWindow: false,
      });
    } catch (quotaError) {
      return res.status(400).json({ error: quotaError.message || 'Gagal memesan kuota tiket' });
    }

    if (method === 'CASH' || totalAmount === 0) {
      // E-ticket hanya dikirim bila petugas mengisi email pembeli sungguhan.
      const mail = rawEmail ? await deliverTicketEmail(order.id) : { sent: false, error: null };
      return res.status(201).json({
        message: 'Tiket loket berhasil diterbitkan',
        emailSent: mail.sent,
        emailError: mail.error,
        order: normalizeOrder(order),
      });
    }

    try {
      const snapResult = await createSnapTransaction({
        orderId: order.orderCode,
        grossAmount: totalAmount,
        customerName: buyerName,
        customerEmail: buyerEmail,
        customerPhone: buyerPhone,
        adminFee,
        itemDetails: [{
          id: `TIKET-OTS-${eventId}`,
          price: unitPrice,
          quantity,
          name: ticketType?.name || 'Tiket Masuk',
        }],
        expiryDurationSeconds: CHECKOUT_EXPIRY_SECONDS,
      });

      const updated = await prisma.ticketOrder.update({
        where: { id: order.id },
        data: {
          midtransOrderId: order.orderCode,
          snapToken: snapResult.token,
          qrisFee: snapResult.qrisFee,
          grossAmount: snapResult.grossAmount,
        },
        include: { attendees: true, ticketType: true },
      });

      return res.status(201).json({
        message: 'Pesanan loket dibuat, tunggu pembayaran QRIS',
        order: {
          ...normalizeOrder(updated),
          paymentAmount: snapResult.grossAmount,
          snapToken: snapResult.token,
          redirectUrl: snapResult.redirectUrl,
        },
      });
    } catch (snapError) {
      await cancelOrderAndReleaseQuota(prisma, order.id, 'CANCELLED');
      return res.status(502).json({
        error: 'Gagal membuat QRIS. Kuota sudah dikembalikan — layani dengan pembayaran TUNAI.',
        detail: snapError.message,
      });
    }
  } catch (error) {
    res.status(500).json({ error: 'Gagal melayani penjualan loket', detail: error.message });
  }
});

// ==================== GERBANG: PEMINDAIAN ====================

router.post('/admin/scan/:ticketCode', async (req, res) => {
  try {
    const ticketCode = normalizeCode(req.params.ticketCode);
    if (!ticketCode) return res.status(400).json({ error: 'Kode tiket tidak valid' });

    const attendee = await prisma.ticketAttendee.findUnique({
      where: { ticketCode },
      include: {
        order: {
          include: {
            ticketType: true,
            event: { select: { id: true, namaEvent: true, userId: true, lokasi: true } },
          },
        },
      },
    });
    if (!attendee) return res.status(404).json({ valid: false, error: 'Tiket tidak ditemukan' });

    const order = attendee.order;

    // 1. Kepemilikan — bukan pemilik acara dan bukan admin, ditolak.
    if (!(await verifyEventOwnership(req, order.event.id))) {
      return res.status(403).json({ valid: false, error: 'Tiket ini bukan untuk event Anda' });
    }

    // 2. Keberlakuan acara — pemindai boleh menyertakan eventId untuk memastikan
    //    tiket dipindai di gerbang acara yang benar.
    const scanEventId = toId(req.body?.eventId);
    if (scanEventId && scanEventId !== order.event.id) {
      return res.status(400).json({
        valid: false,
        error: `Tiket ini untuk event lain (${order.event.namaEvent})`,
      });
    }

    // 3. Tanggal — tiket DAY hanya sah pada hari yang dicakupnya.
    if (!isTicketValidToday(order.ticketType)) {
      const validDate = new Date(order.ticketType.validDate).toLocaleDateString('id-ID', {
        day: 'numeric', month: 'long', year: 'numeric',
      });
      return res.status(400).json({ valid: false, error: `Tiket ini hanya berlaku pada ${validDate}` });
    }

    // 4. Status — ditolak dengan menyebut sebabnya, tanpa menulis apa pun.
    if (attendee.status === 'USED') {
      return res.status(400).json({
        valid: false,
        error: 'Tiket sudah digunakan',
        usedAt: attendee.usedAt,
        attendeeName: attendee.name,
      });
    }
    if (attendee.status !== 'PAID') {
      const reason = {
        PENDING: 'Tiket belum dibayar',
        CANCELLED: 'Tiket sudah dibatalkan',
        EXPIRED: 'Tiket sudah kedaluwarsa',
      }[attendee.status] || 'Tiket tidak berlaku';
      return res.status(400).json({ valid: false, error: reason });
    }

    // 5. Tandai terpakai lewat compare-and-swap: dua gerbang yang memindai kode
    //    sama pada detik yang sama, hanya satu yang menang.
    const claimed = await prisma.ticketAttendee.updateMany({
      where: { id: attendee.id, status: 'PAID' },
      data: { status: 'USED', usedAt: new Date(), scannedById: req.user.id },
    });
    if (claimed.count === 0) {
      return res.status(400).json({ valid: false, error: 'Tiket sudah digunakan' });
    }

    // Ketika tidak ada lagi tiket berstatus PAID dalam satu pesanan, pesanannya
    // ikut ditutup menjadi USED.
    const remainingPaid = await prisma.ticketAttendee.count({
      where: { orderId: order.id, status: 'PAID' },
    });
    if (remainingPaid === 0) {
      await prisma.ticketOrder.updateMany({
        where: { id: order.id, status: 'PAID' },
        data: { status: 'USED' },
      });
    }

    res.json({
      valid: true,
      message: 'Tiket sah — silakan masuk',
      attendee: { id: attendee.id, name: attendee.name, ticketCode: attendee.ticketCode },
      order: {
        orderCode: order.orderCode,
        buyerName: order.buyerName,
        quantity: order.quantity,
        channel: order.channel,
        ticketTypeName: order.ticketType?.name || 'Tiket Masuk',
      },
      event: { id: order.event.id, namaEvent: order.event.namaEvent, lokasi: order.event.lokasi },
      remainingInOrder: remainingPaid,
    });
  } catch (error) {
    res.status(500).json({ valid: false, error: 'Gagal memindai tiket', detail: error.message });
  }
});

// ==================== PANTAU & RAPIKAN ====================

router.get('/admin/event/:eventId/dashboard', async (req, res) => {
  try {
    const eventId = toId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: 'ID event tidak valid' });
    if (!(await verifyEventOwnership(req, eventId))) {
      return res.status(403).json({ error: 'Tidak memiliki akses ke event ini' });
    }

    const config = await getOrCreateConfig(eventId);
    const [byStatus, paidTotals, attendeeStatus, byType, daily] = await Promise.all([
      prisma.ticketOrder.groupBy({
        by: ['status'],
        where: { rekomendasiEventId: eventId },
        _sum: { quantity: true, totalAmount: true, adminFee: true },
        _count: true,
      }),
      prisma.ticketOrder.aggregate({
        where: { rekomendasiEventId: eventId, status: { in: ['PAID', 'USED'] } },
        _sum: {
          quantity: true,
          totalAmount: true,
          adminFee: true,
          qrisFee: true,
          organizerShareAmount: true,
          pengdaShareAmount: true,
        },
        _count: true,
      }),
      prisma.ticketAttendee.groupBy({
        by: ['status'],
        where: { order: { rekomendasiEventId: eventId } },
        _count: true,
      }),
      prisma.ticketOrder.groupBy({
        by: ['ticketTypeId'],
        where: { rekomendasiEventId: eventId, status: { in: ['PAID', 'USED'] } },
        _sum: { quantity: true, totalAmount: true },
        _count: true,
      }),
      prisma.$queryRaw`
        SELECT DATE_FORMAT(COALESCE(paid_at, created_at), '%Y-%m-%d') AS period,
               COUNT(*) AS orders,
               SUM(quantity) AS tickets,
               SUM(total_amount) AS revenue
        FROM ticket_orders
        WHERE rekomendasi_event_id = ${eventId} AND status IN ('PAID', 'USED')
        GROUP BY period
        ORDER BY period DESC
        LIMIT 30`,
    ]);

    const statusMap = Object.fromEntries(byStatus.map((row) => [row.status, row]));
    const attendeeMap = Object.fromEntries(attendeeStatus.map((row) => [row.status, row._count]));
    const typeMap = new Map(config.types.map((type) => [type.id, type]));
    const developerSharePercent = decimalToNumber(config.developerSharePercent);
    const grossRevenue = decimalToNumber(paidTotals._sum.totalAmount);
    const pengdaShare = decimalToNumber(paidTotals._sum.pengdaShareAmount);
    const split = splitPengdaDeveloper(grossRevenue, pengdaShare, developerSharePercent);

    res.json({
      config: normalizeConfig(config),
      summary: {
        grossRevenue,
        adminFee: decimalToNumber(paidTotals._sum.adminFee),
        qrisFee: decimalToNumber(paidTotals._sum.qrisFee),
        organizerShare: decimalToNumber(paidTotals._sum.organizerShareAmount),
        pengdaShare,
        developerShare: split.developerShare,
        pengdaNetShare: split.pengdaNetShare,
        paidOrders: paidTotals._count,
        soldTickets: paidTotals._sum.quantity || 0,
        pendingOrders: statusMap.PENDING?._count || 0,
        pendingTickets: statusMap.PENDING?._sum.quantity || 0,
        cancelledTickets: (statusMap.CANCELLED?._sum.quantity || 0) + (statusMap.EXPIRED?._sum.quantity || 0),
        checkedIn: attendeeMap.USED || 0,
        notCheckedIn: attendeeMap.PAID || 0,
        quota: config.quota,
        soldCount: config.soldCount,
        remainingQuota: remainingQuota(config.quota, config.soldCount),
      },
      byStatus: ORDER_STATUSES.map((status) => ({
        status,
        orders: statusMap[status]?._count || 0,
        tickets: statusMap[status]?._sum.quantity || 0,
        revenue: decimalToNumber(statusMap[status]?._sum.totalAmount),
      })),
      byType: byType.map((row) => ({
        ticketTypeId: row.ticketTypeId,
        name: typeMap.get(row.ticketTypeId)?.name || 'Tanpa jenis',
        orders: row._count,
        tickets: row._sum.quantity || 0,
        revenue: decimalToNumber(row._sum.totalAmount),
      })).sort((a, b) => b.tickets - a.tickets),
      byDay: daily.map((row) => ({
        period: row.period,
        orders: Number(row.orders) || 0,
        tickets: Number(row.tickets) || 0,
        revenue: decimalToNumber(row.revenue),
      })).reverse(),
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat dasbor tiket', detail: error.message });
  }
});

router.get('/admin/orders', async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const status = String(req.query.status || '').toUpperCase();
    const eventId = toId(req.query.eventId);
    const term = String(req.query.search || '').trim();

    const where = {};
    if (!isAdminLikeRole(req.user.role)) where.event = { userId: req.user.id };
    if (eventId) {
      if (!(await verifyEventOwnership(req, eventId))) {
        return res.status(403).json({ error: 'Tidak memiliki akses ke event ini' });
      }
      where.rekomendasiEventId = eventId;
    }
    if (ORDER_STATUSES.includes(status)) where.status = status;
    if (term) {
      where.OR = [
        { buyerName: { contains: term } },
        { buyerEmail: { contains: term } },
        { buyerPhone: { contains: term } },
        { orderCode: { contains: term } },
        { attendees: { some: { ticketCode: { contains: term } } } },
      ];
    }

    const [orders, total, paidAgg] = await Promise.all([
      prisma.ticketOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          attendees: { orderBy: { id: 'asc' } },
          ticketType: { select: { id: true, name: true, kind: true, validDate: true } },
          event: { select: { id: true, namaEvent: true } },
        },
      }),
      prisma.ticketOrder.count({ where }),
      prisma.ticketOrder.aggregate({
        where: { ...where, status: { in: ['PAID', 'USED'] } },
        _sum: { quantity: true, totalAmount: true, adminFee: true },
        _count: true,
      }),
    ]);

    res.json({
      data: orders.map((order) => ({ ...normalizeOrder(order), event: order.event })),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      summary: {
        totalRecords: total,
        paidOrders: paidAgg._count,
        soldTickets: paidAgg._sum.quantity || 0,
        revenue: decimalToNumber(paidAgg._sum.totalAmount),
        adminFee: decimalToNumber(paidAgg._sum.adminFee),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat pembelian tiket', detail: error.message });
  }
});

// Aksi manual panitia: tandai USED (hanya dari PAID) atau batalkan pesanan.
router.patch('/admin/orders/:orderId', async (req, res) => {
  try {
    const orderId = toId(req.params.orderId);
    if (!orderId) return res.status(400).json({ error: 'ID pesanan tidak valid' });

    const order = await prisma.ticketOrder.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, rekomendasiEventId: true, quantity: true, configId: true, ticketTypeId: true, midtransOrderId: true },
    });
    if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan' });
    if (!(await verifyEventOwnership(req, order.rekomendasiEventId))) {
      return res.status(403).json({ error: 'Tidak memiliki akses ke event ini' });
    }

    const action = String(req.body.action || '').toUpperCase();

    if (action === 'USED') {
      if (order.status !== 'PAID') {
        return res.status(400).json({ error: 'Hanya pesanan lunas yang bisa ditandai terpakai' });
      }
      await prisma.$transaction(async (tx) => {
        await tx.ticketAttendee.updateMany({
          where: { orderId: order.id, status: 'PAID' },
          data: { status: 'USED', usedAt: new Date(), scannedById: req.user.id },
        });
        await tx.ticketOrder.update({ where: { id: order.id }, data: { status: 'USED' } });
      });
      return res.json({ status: 'USED', message: 'Pesanan ditandai sudah terpakai' });
    }

    if (action === 'CANCELLED') {
      if (!['PENDING', 'PAID'].includes(order.status)) {
        return res.status(400).json({ error: `Pesanan berstatus ${order.status} tidak bisa dibatalkan` });
      }
      if (order.midtransOrderId && order.status === 'PENDING' && isMidtransConfigured()) {
        try {
          await cancelTransaction(order.midtransOrderId);
        } catch (cancelError) {
          console.error(`[Ticket] Gagal batalkan Midtrans ${order.midtransOrderId}:`, cancelError.message);
        }
      }
      // Pesanan PENDING dibatalkan lewat pelepas kuota bersama; pesanan yang sudah
      // lunas dibatalkan manual di sini — kuotanya tetap dilepas karena kursinya
      // memang tidak jadi dipakai.
      if (order.status === 'PENDING') {
        await cancelOrderAndReleaseQuota(prisma, order.id, 'CANCELLED');
      } else {
        await prisma.$transaction(async (tx) => {
          await tx.ticketOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
          await tx.ticketAttendee.updateMany({
            where: { orderId: order.id },
            data: { status: 'CANCELLED' },
          });
          await tx.eventTicketConfig.update({
            where: { id: order.configId },
            data: { soldCount: { decrement: order.quantity } },
          });
          if (order.ticketTypeId) {
            await tx.ticketType.update({
              where: { id: order.ticketTypeId },
              data: { soldCount: { decrement: order.quantity } },
            });
          }
        });
      }
      return res.json({ status: 'CANCELLED', message: 'Pesanan dibatalkan dan kuota dikembalikan' });
    }

    return res.status(400).json({ error: 'Aksi harus USED atau CANCELLED' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memperbarui pesanan', detail: error.message });
  }
});

// Kirim ulang e-ticket, boleh ke alamat lain bila email pembeli salah tulis.
router.post('/admin/orders/:orderId/resend-email', async (req, res) => {
  try {
    const orderId = toId(req.params.orderId);
    if (!orderId) return res.status(400).json({ error: 'ID pesanan tidak valid' });

    const order = await prisma.ticketOrder.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, rekomendasiEventId: true },
    });
    if (!order) return res.status(404).json({ error: 'Pesanan tidak ditemukan' });
    if (!(await verifyEventOwnership(req, order.rekomendasiEventId))) {
      return res.status(403).json({ error: 'Tidak memiliki akses ke event ini' });
    }
    if (!['PAID', 'USED'].includes(order.status)) {
      return res.status(400).json({ error: 'E-ticket hanya bisa dikirim untuk pesanan lunas' });
    }

    const overrideEmail = String(req.body.email || '').trim().toLowerCase() || null;
    if (overrideEmail && !isValidEmail(overrideEmail)) {
      return res.status(400).json({ error: 'Format email tujuan tidak valid' });
    }

    const full = await prisma.ticketOrder.findUnique({
      where: { id: order.id },
      include: {
        attendees: { orderBy: { id: 'asc' } },
        ticketType: true,
        config: true,
        event: true,
      },
    });

    // Di sini error SMTP sengaja dilempar ke pemanggil: panitia menekan tombol
    // kirim ulang dan berhak tahu kalau gagal, tidak seperti jalur webhook.
    await sendTicketEmail({
      event: full.event,
      config: full.config,
      order: normalizeOrder(full),
      attendees: full.attendees,
      overrideEmail,
    });
    await prisma.ticketOrder.update({
      where: { id: order.id },
      data: { emailSentAt: new Date() },
    });

    res.json({ message: `E-ticket dikirim ke ${overrideEmail || full.buyerEmail}` });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Gagal mengirim e-ticket' });
  }
});

// Hitung ulang sold_count bila angka terjual terasa melenceng.
router.post('/admin/event/:eventId/sync-sold-count', async (req, res) => {
  try {
    const eventId = toId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: 'ID event tidak valid' });
    if (!(await verifyEventOwnership(req, eventId))) {
      return res.status(403).json({ error: 'Tidak memiliki akses ke event ini' });
    }

    const config = await getOrCreateConfig(eventId);
    const result = await syncSoldCount(prisma, config.id);
    const fresh = await prisma.eventTicketConfig.findUnique({
      where: { id: config.id },
      include: { types: typeInclude },
    });

    res.json({
      message: `Jumlah terjual disinkronkan (${result.configSoldCount} tiket)`,
      config: normalizeConfig(fresh),
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menyinkronkan jumlah terjual', detail: error.message });
  }
});

// Status pengiriman email — dipakai panel untuk memberi tahu bahwa SMTP belum
// disetel sebelum hari-H, bukan setelah tiket pertama gagal terkirim.
router.get('/admin/mailer-status', async (req, res) => {
  const configured = isMailerConfigured();
  if (!configured) {
    return res.json({
      configured: false,
      ok: false,
      message: 'SMTP belum dikonfigurasi. E-ticket tidak akan terkirim ke email pembeli.',
    });
  }
  try {
    await verifyMailer();
    res.json({ configured: true, ok: true, message: 'Koneksi SMTP berhasil' });
  } catch (error) {
    res.json({ configured: true, ok: false, message: `Koneksi SMTP gagal: ${error.message}` });
  }
});

module.exports = router;
