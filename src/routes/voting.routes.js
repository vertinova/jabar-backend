const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const router = require('express').Router();
const prisma = require('../lib/prisma');
const upload = require('../middleware/upload.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const {
  calculateQrisFee,
  createSnapTransaction,
  cancelTransaction,
  refundTransaction,
  getTransactionStatus,
  isMidtransConfigured,
  resolvePaymentStatus,
} = require('../lib/midtrans');
const {
  applyPaidVotingPurchaseVotes,
  calculateVotingAdminFee,
  calculateVotingRevenueSplit,
  finalizeVotingPurchaseSuccess,
} = require('../lib/votingPayment');

const optionalAuthenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return next();
  return authenticate(req, res, next);
};

// SUPERADMIN manages every organizer's vote just like ADMIN does (but only here,
// in the voting module — it has no access to the rest of the admin panel).
const isAdminRole = (role) => role === 'ADMIN' || role === 'SUPERADMIN';

const canManageVoting = (req, res, next) => {
  if (['ADMIN', 'SUPERADMIN', 'PENYELENGGARA'].includes(req.user?.role)) return next();
  return res.status(403).json({ error: 'Akses ditolak' });
};

const toId = (value) => {
  const id = Number.parseInt(value, 10);
  return Number.isFinite(id) ? id : null;
};

const deleteUploadedFile = (filePath) => {
  if (!filePath?.startsWith('/uploads/')) return;
  const absolutePath = path.join(__dirname, '..', '..', filePath.replace(/^\/+/, ''));
  if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
};

const validateVotingPoster = (file) => {
  if (!file) return null;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
    return 'Poster harus berupa JPG, PNG, atau WEBP';
  }
  if (file.size > 5 * 1024 * 1024) {
    return 'Ukuran poster maksimal 5 MB';
  }
  return null;
};

const toPositiveInteger = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 ? number : null;
};

const decimalToNumber = (value) => (value === null || value === undefined ? 0 : Number(value));

const normalizeVotingConfig = (config) => {
  if (!config) return config;
  return {
    ...config,
    pricePerVote: decimalToNumber(config.pricePerVote),
    organizerSharePercent: decimalToNumber(config.organizerSharePercent),
    pengdaSharePercent: decimalToNumber(config.pengdaSharePercent),
  };
};

const includeConfig = {
  categories: {
    orderBy: { order: 'asc' },
    include: {
      nominees: { orderBy: { voteCount: 'desc' } },
      _count: { select: { nominees: true, votes: true } },
    },
  },
};

const normalizeEvent = (event) => {
  if (!event) return event;
  return {
    ...event,
    votingConfig: normalizeVotingConfig(event.votingConfig),
  };
};

const getClientIp = (req) =>
  req.headers['x-forwarded-for']?.toString().split(',')[0] ||
  req.socket.remoteAddress ||
  '';

const verifyEventOwnership = async (req, eventId) => {
  if (isAdminRole(req.user?.role)) return true;
  const event = await prisma.rekomendasiEvent.findUnique({
    where: { id: eventId },
    select: { userId: true },
  });
  return event?.userId === req.user?.id;
};

const getEventIdForCategory = async (categoryId) => {
  const category = await prisma.votingCategory.findUnique({
    where: { id: categoryId },
    select: { config: { select: { rekomendasiEventId: true } } },
  });
  return category?.config?.rekomendasiEventId || null;
};

const getEventIdForNominee = async (nomineeId) => {
  const nominee = await prisma.votingNominee.findUnique({
    where: { id: nomineeId },
    select: {
      category: { select: { config: { select: { rekomendasiEventId: true } } } },
    },
  });
  return nominee?.category?.config?.rekomendasiEventId || null;
};

const generatePurchaseCode = () => {
  const random = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `VOT-${random.slice(0, 8)}-${random.slice(8)}`;
};

const QRIS_MAX_TRANSACTION = 10000000;
const REFRESHABLE_PURCHASE_STATUSES = ['PENDING', 'CANCELLED', 'EXPIRED'];

const normalizePurchaseCode = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase().replace(/[\s\u200B-\u200D\uFEFF]+/g, '');
};

const getPurchaseLookupWhere = (code) => ({
  OR: [{ purchaseCode: code }, { midtransOrderId: code }],
});

const getPaymentMessage = (status) => {
  if (status === 'PENDING') return 'Pembayaran belum dikonfirmasi. Tunggu beberapa saat lalu coba lagi.';
  if (status === 'EXPIRED') return 'Pembayaran kedaluwarsa. Silakan buat pesanan baru.';
  if (status === 'CANCELLED') return 'Pembayaran dibatalkan. Silakan buat pesanan baru.';
  return 'Kode pembelian tidak valid atau belum dibayar';
};

const validatePaidVotingTarget = async (eventId, categoryId, nomineeId) => {
  const parsedCategoryId = toId(categoryId);
  const parsedNomineeId = toId(nomineeId);
  if (!parsedCategoryId || !parsedNomineeId) {
    throw new Error('Nominee wajib dipilih sebelum membeli vote');
  }

  const category = await prisma.votingCategory.findUnique({
    where: { id: parsedCategoryId },
    include: { config: true },
  });

  if (
    !category ||
    category.config.rekomendasiEventId !== eventId ||
    !category.isActive ||
    !category.config.enabled ||
    !category.config.isPaid ||
    category.config.approvalStatus !== 'APPROVED'
  ) {
    throw new Error('Kategori voting tidak tersedia');
  }

  const now = new Date();
  if (category.config.startDate && now < category.config.startDate) {
    throw new Error('Voting belum dimulai');
  }
  if (category.config.endDate && now > category.config.endDate) {
    throw new Error('Voting sudah ditutup');
  }

  const nominee = await prisma.votingNominee.findFirst({
    where: { id: parsedNomineeId, categoryId: parsedCategoryId, isActive: true },
  });
  if (!nominee) throw new Error('Nominee tidak ditemukan dalam kategori ini');

  return { category, nominee };
};

const refreshVotingPurchasePaymentStatus = async (purchaseId) => {
  const purchase = await prisma.votingPurchase.findUnique({ where: { id: purchaseId } });
  if (!purchase?.midtransOrderId || !REFRESHABLE_PURCHASE_STATUSES.includes(purchase.status)) return purchase;

  const txStatus = await getTransactionStatus(purchase.midtransOrderId);
  const paymentResult = resolvePaymentStatus(txStatus.transaction_status, txStatus.fraud_status);

  if (paymentResult === 'success') {
    // Applies votes only when voting is still open; otherwise refunds + cancels.
    await finalizeVotingPurchaseSuccess(prisma, purchase.id, {
      paymentType: txStatus.payment_type || null,
      refund: (orderId) => refundTransaction(orderId, {
        reason: 'Voting sudah ditutup sebelum pembayaran selesai',
      }),
    });
    return prisma.votingPurchase.findUnique({ where: { id: purchase.id } });
  }

  if (paymentResult === 'failed' || paymentResult === 'expired') {
    return prisma.votingPurchase.update({
      where: { id: purchase.id },
      data: {
        status: paymentResult === 'expired' ? 'EXPIRED' : 'CANCELLED',
        paymentType: txStatus.payment_type || null,
      },
    });
  }

  return purchase;
};

// Public: list approved events with active voting.
router.get('/events', async (req, res) => {
  try {
    const { search = '', page = '1', limit = '12' } = req.query;
    const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 12));
    const skip = (pageNum - 1) * limitNum;

    const where = {
      status: 'DISETUJUI',
      votingConfig: { is: { enabled: true, approvalStatus: 'APPROVED' } },
    };

    if (search) {
      where.OR = [
        { namaEvent: { contains: search } },
        { lokasi: { contains: search } },
        { penyelenggara: { contains: search } },
        { jenisEvent: { contains: search } },
      ];
    }

    const [events, total] = await Promise.all([
      prisma.rekomendasiEvent.findMany({
        where,
        orderBy: { tanggalMulai: 'asc' },
        skip,
        take: limitNum,
        include: {
          votingConfig: {
            include: {
              categories: {
                where: { isActive: true },
                orderBy: { order: 'asc' },
                include: { _count: { select: { nominees: true, votes: true } } },
              },
            },
          },
        },
      }),
      prisma.rekomendasiEvent.count({ where }),
    ]);

    res.json({
      data: events.map(normalizeEvent),
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat event voting', detail: error.message });
  }
});

router.get('/events/:eventId', async (req, res) => {
  try {
    const eventId = toId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: 'ID event tidak valid' });

    const event = await prisma.rekomendasiEvent.findFirst({
      where: {
        id: eventId,
        status: 'DISETUJUI',
        votingConfig: { is: { enabled: true, approvalStatus: 'APPROVED' } },
      },
      include: {
        votingConfig: {
          include: {
            categories: {
              where: { isActive: true },
              orderBy: { order: 'asc' },
              include: { nominees: { where: { isActive: true }, orderBy: { voteCount: 'desc' } } },
            },
          },
        },
      },
    });

    if (!event) return res.status(404).json({ error: 'Event voting tidak ditemukan' });
    res.json(normalizeEvent(event));
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat detail voting', detail: error.message });
  }
});

router.post('/vote', optionalAuthenticate, async (req, res) => {
  try {
    const categoryId = toId(req.body.categoryId);
    const nomineeId = toId(req.body.nomineeId);
    const voterEmail = req.body.voterEmail || req.user?.email || null;
    const voterName = req.body.voterName || req.user?.name || null;

    if (!categoryId || !nomineeId) {
      return res.status(400).json({ error: 'Kategori dan nominee wajib dipilih' });
    }

    const category = await prisma.votingCategory.findUnique({
      where: { id: categoryId },
      include: { config: true },
    });

    if (
      !category ||
      !category.isActive ||
      !category.config.enabled ||
      category.config.approvalStatus !== 'APPROVED'
    ) {
      return res.status(404).json({ error: 'Kategori voting tidak tersedia' });
    }

    const now = new Date();
    if (category.config.startDate && now < category.config.startDate) {
      return res.status(400).json({ error: 'Voting belum dimulai' });
    }
    if (category.config.endDate && now > category.config.endDate) {
      return res.status(400).json({ error: 'Voting sudah ditutup' });
    }
    if (category.config.isPaid) {
      return res.status(400).json({ error: 'Voting berbayar belum diaktifkan di aplikasi ini' });
    }

    const nominee = await prisma.votingNominee.findFirst({ where: { id: nomineeId, categoryId, isActive: true } });
    if (!nominee) return res.status(404).json({ error: 'Nominee tidak ditemukan' });

    const vote = await prisma.$transaction(async (tx) => {
      const created = await tx.votingVote.create({
        data: {
          categoryId,
          nomineeId,
          voterName,
          voterEmail,
          voterIp: getClientIp(req),
        },
      });
      await tx.votingNominee.update({
        where: { id: nomineeId },
        data: { voteCount: { increment: 1 } },
      });
      return created;
    });

    res.status(201).json({ message: 'Vote berhasil', vote });
  } catch (error) {
    res.status(500).json({ error: 'Gagal melakukan vote', detail: error.message });
  }
});

router.post('/purchase', optionalAuthenticate, async (req, res) => {
  try {
    const eventId = toId(req.body.eventId);
    const voteCount = Number(req.body.voteCount);
    const { categoryId, nomineeId, buyerName, buyerEmail, buyerPhone } = req.body;
    if (!eventId || !buyerName || !buyerEmail) {
      return res.status(400).json({ error: 'Event, nama, dan email pembeli wajib diisi' });
    }

    if (!Number.isInteger(voteCount) || voteCount < 1) {
      return res.status(400).json({ error: 'Jumlah vote harus minimal 1' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(buyerEmail)) {
      return res.status(400).json({ error: 'Format email tidak valid' });
    }

    const event = await prisma.rekomendasiEvent.findUnique({
      where: { id: eventId },
      include: { votingConfig: true },
    });
    const config = event?.votingConfig;
    if (
      !event ||
      event.status !== 'DISETUJUI' ||
      !config ||
      !config.enabled ||
      !config.isPaid ||
      config.approvalStatus !== 'APPROVED'
    ) {
      return res.status(400).json({ error: 'Voting berbayar tidak tersedia untuk event ini' });
    }

    let votingTarget;
    try {
      votingTarget = await validatePaidVotingTarget(eventId, categoryId, nomineeId);
    } catch (targetError) {
      return res.status(400).json({ error: targetError.message || 'Nominee voting tidak valid' });
    }

    const pricePerVote = decimalToNumber(config.pricePerVote);
    const totalAmount = pricePerVote * voteCount;
    const adminFee = calculateVotingAdminFee(totalAmount, voteCount);
    const { grossAmount: paymentAmount, fee: qrisFeeEstimate } = calculateQrisFee(totalAmount + adminFee);
    const revenueSplit = calculateVotingRevenueSplit(
      totalAmount,
      config.organizerSharePercent,
      config.pengdaSharePercent
    );

    if (paymentAmount > QRIS_MAX_TRANSACTION) {
      const affordableVotes = pricePerVote > 0
        ? Math.max(1, Math.floor((QRIS_MAX_TRANSACTION * 0.99 - calculateVotingAdminFee(QRIS_MAX_TRANSACTION, voteCount)) / pricePerVote))
        : 1;
      return res.status(400).json({
        error: `Total harga vote, biaya admin, dan biaya QRIS tidak boleh melebihi Rp ${QRIS_MAX_TRANSACTION.toLocaleString('id-ID')} per transaksi.`,
        maxVoteCount: affordableVotes,
        maxPaymentAmount: QRIS_MAX_TRANSACTION,
      });
    }

    if (totalAmount > 0 && !isMidtransConfigured()) {
      return res.status(503).json({ error: 'Payment gateway belum dikonfigurasi' });
    }

    const purchaseCode = generatePurchaseCode();
    const voterIp = getClientIp(req);

    const purchase = await prisma.$transaction(async (tx) => {
      const created = await tx.votingPurchase.create({
        data: {
          rekomendasiEventId: eventId,
          buyerName,
          buyerEmail,
          buyerPhone: buyerPhone || null,
          categoryId: votingTarget.category.id,
          nomineeId: votingTarget.nominee.id,
          voteCount,
          totalAmount,
          adminFee,
          ...revenueSplit,
          purchaseCode,
          status: totalAmount === 0 ? 'PAID' : 'PENDING',
          paidAt: totalAmount === 0 ? new Date() : null,
        },
      });

      if (totalAmount === 0) {
        await applyPaidVotingPurchaseVotes(tx, created.id, voterIp);
      }

      return tx.votingPurchase.findUnique({ where: { id: created.id } });
    });

    let snapToken = null;
    let redirectUrl = null;
    let midtransOrderId = null;
    let grossAmount = decimalToNumber(purchase.grossAmount);
    let qrisFee = decimalToNumber(purchase.qrisFee);

    if (totalAmount > 0) {
      midtransOrderId = purchaseCode;
      // Expire the payment window at the voting close time so a QRIS code cannot
      // be paid after voting has ended.
      const votingEndDate = config.endDate ? new Date(config.endDate) : null;
      const expiryDurationSeconds = votingEndDate
        ? Math.floor((votingEndDate.getTime() - Date.now()) / 1000)
        : null;
      const snapResult = await createSnapTransaction({
        orderId: midtransOrderId,
        grossAmount: totalAmount,
        customerName: buyerName,
        customerEmail: buyerEmail,
        customerPhone: buyerPhone,
        adminFee,
        itemDetails: [
          {
            id: `VOTE-${eventId}`,
            price: pricePerVote,
            quantity: voteCount,
            name: 'Paket Vote',
          },
        ],
        expiryDurationSeconds,
      });
      snapToken = snapResult.token;
      redirectUrl = snapResult.redirectUrl;
      grossAmount = snapResult.grossAmount;
      qrisFee = snapResult.qrisFee;

      await prisma.votingPurchase.update({
        where: { id: purchase.id },
        data: { midtransOrderId, snapToken, qrisFee, grossAmount },
      });
    }

    res.status(201).json({
      message: totalAmount === 0 ? 'Vote berhasil masuk' : 'Pesanan vote berhasil dibuat',
      purchase: {
        ...purchase,
        totalAmount: decimalToNumber(purchase.totalAmount),
        adminFee,
        qrisFee: qrisFee || qrisFeeEstimate,
        grossAmount,
        paymentAmount: grossAmount || paymentAmount,
        snapToken,
        redirectUrl,
        midtransOrderId,
        nomineeName: votingTarget.nominee.nomineeName,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal membuat pesanan vote', detail: error.message });
  }
});

router.post('/payment-status', optionalAuthenticate, async (req, res) => {
  try {
    const purchaseCode = normalizePurchaseCode(req.body.purchaseCode || req.body.orderId);
    if (!purchaseCode) return res.status(400).json({ error: 'Kode pembelian wajib diisi' });

    let purchase = await prisma.votingPurchase.findFirst({
      where: getPurchaseLookupWhere(purchaseCode),
      include: {
        event: { select: { id: true, namaEvent: true } },
      },
    });
    if (!purchase) return res.status(404).json({ error: 'Kode pembelian tidak valid' });

    if (purchase.midtransOrderId && REFRESHABLE_PURCHASE_STATUSES.includes(purchase.status)) {
      try {
        const refreshed = await refreshVotingPurchasePaymentStatus(purchase.id);
        if (refreshed) {
          purchase = await prisma.votingPurchase.findUnique({
            where: { id: purchase.id },
            include: { event: { select: { id: true, namaEvent: true } } },
          });
        }
      } catch (midtransError) {
        console.error('Gagal refresh status Midtrans voting:', midtransError);
      }
    }

    res.json({
      purchaseCode: purchase.purchaseCode,
      midtransOrderId: purchase.midtransOrderId,
      eventId: purchase.rekomendasiEventId,
      eventTitle: purchase.event?.namaEvent,
      status: purchase.status,
      voteCount: purchase.voteCount,
      usedVotes: purchase.usedVotes,
      remainingVotes: Math.max(0, purchase.voteCount - purchase.usedVotes),
      totalAmount: decimalToNumber(purchase.totalAmount),
      adminFee: decimalToNumber(purchase.adminFee),
      qrisFee: decimalToNumber(purchase.qrisFee),
      grossAmount: decimalToNumber(purchase.grossAmount),
      message: purchase.status === 'PAID' ? 'Pembayaran berhasil' : getPaymentMessage(purchase.status),
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memeriksa status pembayaran', detail: error.message });
  }
});

// Cancel an abandoned checkout so it does not linger as PENDING.
// Refreshes from Midtrans first, so a payment the buyer actually completed is
// honored (PAID) instead of being wrongly cancelled.
router.post('/cancel-purchase', optionalAuthenticate, async (req, res) => {
  try {
    const purchaseCode = normalizePurchaseCode(req.body.purchaseCode || req.body.orderId);
    if (!purchaseCode) return res.status(400).json({ error: 'Kode pembelian wajib diisi' });

    let purchase = await prisma.votingPurchase.findFirst({
      where: getPurchaseLookupWhere(purchaseCode),
    });
    if (!purchase) return res.status(404).json({ error: 'Kode pembelian tidak valid' });

    if (purchase.status === 'PAID') {
      return res.json({ status: 'PAID', message: 'Pembayaran sudah berhasil' });
    }
    if (['CANCELLED', 'EXPIRED'].includes(purchase.status)) {
      return res.json({ status: purchase.status, message: 'Transaksi sudah dibatalkan' });
    }

    // Reconcile with Midtrans — the buyer may have paid even though the popup closed.
    if (purchase.midtransOrderId) {
      try {
        await refreshVotingPurchasePaymentStatus(purchase.id);
        purchase = await prisma.votingPurchase.findUnique({ where: { id: purchase.id } });
      } catch (midtransError) {
        console.error('Gagal refresh sebelum membatalkan voting:', midtransError.message);
      }
    }

    if (purchase.status !== 'PENDING') {
      return res.json({ status: purchase.status, message: getPaymentMessage(purchase.status) });
    }

    // Still unpaid — cancel at Midtrans (best effort) and locally.
    if (purchase.midtransOrderId) {
      try {
        await cancelTransaction(purchase.midtransOrderId);
      } catch (cancelError) {
        console.error('Gagal membatalkan transaksi Midtrans voting:', cancelError.message);
      }
    }

    const updated = await prisma.votingPurchase.update({
      where: { id: purchase.id },
      data: { status: 'CANCELLED' },
    });
    res.json({ status: updated.status, message: 'Transaksi dibatalkan' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal membatalkan transaksi', detail: error.message });
  }
});

router.post('/admin/events', authenticate, canManageVoting, upload.single('poster'), async (req, res) => {
  try {
    const posterPath = req.file ? `/uploads/${req.file.filename}` : null;
    const rejectCreate = (message) => {
      deleteUploadedFile(posterPath);
      return res.status(400).json({ error: message });
    };
    const posterError = validateVotingPoster(req.file);
    if (posterError) return rejectCreate(posterError);

    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const location = String(req.body.location || '').trim();
    const startDate = req.body.startDate ? new Date(req.body.startDate) : null;
    const endDate = req.body.endDate ? new Date(req.body.endDate) : null;

    if (!title) return rejectCreate('Judul vote wajib diisi');
    if (title.length > 191) return rejectCreate('Judul vote maksimal 191 karakter');
    if (location.length > 191) return rejectCreate('Lokasi maksimal 191 karakter');
    if (startDate && Number.isNaN(startDate.getTime())) {
      return rejectCreate('Tanggal mulai tidak valid');
    }
    if (endDate && Number.isNaN(endDate.getTime())) {
      return rejectCreate('Tanggal selesai tidak valid');
    }
    if (startDate && endDate && endDate <= startDate) {
      return rejectCreate('Tanggal selesai harus setelah tanggal mulai');
    }

    const owner = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, phone: true, pengcabId: true },
    });
    if (!owner) {
      deleteUploadedFile(posterPath);
      return res.status(404).json({ error: 'Akun penyelenggara tidak ditemukan' });
    }

    const event = await prisma.$transaction(async (tx) => {
      const createdEvent = await tx.rekomendasiEvent.create({
        data: {
          namaEvent: title,
          jenisEvent: 'E-Voting',
          tanggalMulai: startDate,
          tanggalSelesai: endDate,
          lokasi: location || null,
          deskripsi: description || null,
          poster: posterPath,
          penyelenggara: owner.name,
          kontakPerson: owner.phone,
          status: 'DISETUJUI',
          userId: owner.id,
          pengcabId: owner.pengcabId,
        },
      });

      await tx.eventVotingConfig.create({
        data: {
          rekomendasiEventId: createdEvent.id,
          startDate,
          endDate,
          approvalStatus: 'PENDING',
        },
      });

      return tx.rekomendasiEvent.findUnique({
        where: { id: createdEvent.id },
        include: {
          votingConfig: {
            include: {
              categories: {
                include: { _count: { select: { nominees: true, votes: true } } },
              },
            },
          },
        },
      });
    });

    res.status(201).json({
      message: 'Vote berhasil dibuat dan diajukan ke FORBASI Pusat',
      event: normalizeEvent(event),
    });
  } catch (error) {
    if (req.file) deleteUploadedFile(`/uploads/${req.file.filename}`);
    res.status(500).json({ error: 'Gagal membuat vote', detail: error.message });
  }
});

router.put('/admin/events/:eventId/poster', authenticate, canManageVoting, upload.single('poster'), async (req, res) => {
  const posterPath = req.file ? `/uploads/${req.file.filename}` : null;
  try {
    const eventId = toId(req.params.eventId);
    if (!eventId) {
      deleteUploadedFile(posterPath);
      return res.status(400).json({ error: 'ID event tidak valid' });
    }
    if (!(await verifyEventOwnership(req, eventId))) {
      deleteUploadedFile(posterPath);
      return res.status(403).json({ error: 'Tidak memiliki akses ke event ini' });
    }
    if (!req.file) return res.status(400).json({ error: 'File poster wajib dipilih' });

    const posterError = validateVotingPoster(req.file);
    if (posterError) {
      deleteUploadedFile(posterPath);
      return res.status(400).json({ error: posterError });
    }

    const existing = await prisma.rekomendasiEvent.findUnique({
      where: { id: eventId },
      select: { poster: true, votingConfig: { select: { id: true } } },
    });
    if (!existing?.votingConfig) {
      deleteUploadedFile(posterPath);
      return res.status(404).json({ error: 'Vote tidak ditemukan' });
    }

    const event = await prisma.rekomendasiEvent.update({
      where: { id: eventId },
      data: { poster: posterPath },
      include: {
        votingConfig: {
          include: {
            categories: {
              include: { _count: { select: { nominees: true, votes: true } } },
            },
          },
        },
      },
    });

    if (existing.poster && existing.poster !== posterPath) deleteUploadedFile(existing.poster);
    res.json({ message: 'Poster vote berhasil disimpan', event: normalizeEvent(event) });
  } catch (error) {
    deleteUploadedFile(posterPath);
    res.status(500).json({ error: 'Gagal menyimpan poster vote', detail: error.message });
  }
});

router.get('/admin/events', authenticate, canManageVoting, async (req, res) => {
  try {
    // Super admin only manages votes already approved by FORBASI Pusat; the owning
    // penyelenggara still sees all of theirs (including pending) to configure them.
    const where = isAdminRole(req.user.role)
      ? { votingConfig: { is: { approvalStatus: 'APPROVED' } } }
      : { userId: req.user.id, votingConfig: { isNot: null } };
    const events = await prisma.rekomendasiEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        votingConfig: { include: { categories: { include: { _count: { select: { nominees: true, votes: true } } } } } },
      },
    });
    res.json(events.map(normalizeEvent));
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat event penyelenggara', detail: error.message });
  }
});

router.get('/admin/wallet', authenticate, canManageVoting, async (req, res) => {
  try {
    const eventWhere = isAdminRole(req.user.role)
      ? { votingConfig: { is: { approvalStatus: 'APPROVED' } } }
      : { userId: req.user.id, votingConfig: { isNot: null } };
    const purchaseWhere = isAdminRole(req.user.role) ? {} : { event: { userId: req.user.id } };
    const withdrawalWhere = isAdminRole(req.user.role) ? {} : { userId: req.user.id };
    const [purchases, paidTotals, paidByEvent, events, withdrawalByStatus] = await Promise.all([
      prisma.votingPurchase.findMany({
        where: purchaseWhere,
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { event: { select: { id: true, namaEvent: true } } },
      }),
      prisma.votingPurchase.aggregate({
        where: { ...purchaseWhere, status: 'PAID' },
        _sum: {
          totalAmount: true,
          organizerShareAmount: true,
          pengdaShareAmount: true,
          adminFee: true,
          qrisFee: true,
          voteCount: true,
        },
        _count: true,
      }),
      prisma.votingPurchase.groupBy({
        by: ['rekomendasiEventId'],
        where: { ...purchaseWhere, status: 'PAID' },
        _sum: {
          totalAmount: true,
          organizerShareAmount: true,
          pengdaShareAmount: true,
          voteCount: true,
        },
        _count: true,
      }),
      prisma.rekomendasiEvent.findMany({
        where: eventWhere,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          namaEvent: true,
          penyelenggara: true,
          user: { select: { id: true, name: true } },
          votingConfig: {
            select: {
              approvalStatus: true,
              organizerSharePercent: true,
              pengdaSharePercent: true,
            },
          },
        },
      }),
      prisma.withdrawalRequest.groupBy({
        by: ['status'],
        where: withdrawalWhere,
        _sum: { amount: true },
      }),
    ]);

    const withdrawalSum = (statuses) => withdrawalByStatus
      .filter((item) => statuses.includes(item.status))
      .reduce((sum, item) => sum + decimalToNumber(item._sum.amount), 0);
    const organizerBalance = decimalToNumber(paidTotals._sum.organizerShareAmount);
    const pendingWithdrawal = withdrawalSum(['PENDING', 'APPROVED']);
    const withdrawnAmount = withdrawalSum(['PAID']);
    const availableBalance = Math.max(0, organizerBalance - pendingWithdrawal - withdrawnAmount);

    const summary = {
      grossRevenue: decimalToNumber(paidTotals._sum.totalAmount),
      organizerBalance,
      pengdaShare: decimalToNumber(paidTotals._sum.pengdaShareAmount),
      adminFee: decimalToNumber(paidTotals._sum.adminFee),
      qrisFee: decimalToNumber(paidTotals._sum.qrisFee),
      paidVotes: paidTotals._sum.voteCount || 0,
      paidTransactions: paidTotals._count,
      pendingWithdrawal,
      withdrawnAmount,
      availableBalance,
    };

    const paidEventMap = new Map(paidByEvent.map((item) => [item.rekomendasiEventId, item]));
    const eventSummaries = events.map((event) => {
      const paid = paidEventMap.get(event.id);
      return {
        eventId: event.id,
        eventName: event.namaEvent,
        organizerId: event.user?.id || null,
        organizerName: event.user?.name || event.penyelenggara || 'Tanpa penyelenggara',
        approvalStatus: event.votingConfig?.approvalStatus || 'PENDING',
        organizerSharePercent: decimalToNumber(event.votingConfig?.organizerSharePercent),
        pengdaSharePercent: decimalToNumber(event.votingConfig?.pengdaSharePercent),
        grossRevenue: decimalToNumber(paid?._sum.totalAmount),
        organizerBalance: decimalToNumber(paid?._sum.organizerShareAmount),
        pengdaShare: decimalToNumber(paid?._sum.pengdaShareAmount),
        paidVotes: paid?._sum.voteCount || 0,
        paidTransactions: paid?._count || 0,
      };
    });

    res.json({
      summary,
      events: eventSummaries,
      transactions: purchases.map((purchase) => ({
        id: purchase.id,
        purchaseCode: purchase.purchaseCode,
        eventId: purchase.rekomendasiEventId,
        eventName: purchase.event.namaEvent,
        buyerName: purchase.buyerName,
        voteCount: purchase.voteCount,
        status: purchase.status,
        totalAmount: decimalToNumber(purchase.totalAmount),
        adminFee: decimalToNumber(purchase.adminFee),
        qrisFee: decimalToNumber(purchase.qrisFee),
        organizerSharePercent: decimalToNumber(purchase.organizerSharePercent),
        pengdaSharePercent: decimalToNumber(purchase.pengdaSharePercent),
        organizerShareAmount: decimalToNumber(purchase.organizerShareAmount),
        pengdaShareAmount: decimalToNumber(purchase.pengdaShareAmount),
        paidAt: purchase.paidAt,
        createdAt: purchase.createdAt,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat saldo voting', detail: error.message });
  }
});

// Detailed, paginated transaction history for the organizer. Unlike /admin/wallet
// (which caps at 200 rows and only exposes the buyer name), this exposes full
// buyer contact data and the nominee/category each purchase was cast for, plus
// filtering by status/event and free-text search.
const PURCHASE_STATUSES = ['PENDING', 'PAID', 'CANCELLED', 'EXPIRED'];

router.get('/admin/transactions', authenticate, canManageVoting, async (req, res) => {
  try {
    const { search = '', status = '', eventId = '', page = '1', limit = '20' } = req.query;
    const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where = isAdminRole(req.user.role) ? {} : { event: { userId: req.user.id } };

    const parsedEventId = toId(eventId);
    if (parsedEventId) where.rekomendasiEventId = parsedEventId;

    const normalizedStatus = String(status).toUpperCase();
    if (PURCHASE_STATUSES.includes(normalizedStatus)) where.status = normalizedStatus;

    const term = String(search).trim();
    if (term) {
      where.OR = [
        { buyerName: { contains: term } },
        { buyerEmail: { contains: term } },
        { buyerPhone: { contains: term } },
        { purchaseCode: { contains: term } },
      ];
    }

    const [purchases, total, paidAgg] = await Promise.all([
      prisma.votingPurchase.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
        include: { event: { select: { id: true, namaEvent: true } } },
      }),
      prisma.votingPurchase.count({ where }),
      prisma.votingPurchase.aggregate({
        where: { ...where, status: 'PAID' },
        _sum: { totalAmount: true, voteCount: true, organizerShareAmount: true },
        _count: true,
      }),
    ]);

    // VotingPurchase stores categoryId/nomineeId as plain ids (no relation), so
    // resolve their display names in one batched lookup each.
    const categoryIds = [...new Set(purchases.map((p) => p.categoryId).filter(Boolean))];
    const nomineeIds = [...new Set(purchases.map((p) => p.nomineeId).filter(Boolean))];
    const [categories, nominees] = await Promise.all([
      categoryIds.length
        ? prisma.votingCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true, title: true } })
        : [],
      nomineeIds.length
        ? prisma.votingNominee.findMany({ where: { id: { in: nomineeIds } }, select: { id: true, nomineeName: true } })
        : [],
    ]);
    const categoryMap = new Map(categories.map((c) => [c.id, c.title]));
    const nomineeMap = new Map(nominees.map((n) => [n.id, n.nomineeName]));

    res.json({
      data: purchases.map((purchase) => ({
        id: purchase.id,
        purchaseCode: purchase.purchaseCode,
        eventId: purchase.rekomendasiEventId,
        eventName: purchase.event?.namaEvent,
        buyerName: purchase.buyerName,
        buyerEmail: purchase.buyerEmail,
        buyerPhone: purchase.buyerPhone,
        categoryName: purchase.categoryId ? categoryMap.get(purchase.categoryId) || null : null,
        nomineeName: purchase.nomineeId ? nomineeMap.get(purchase.nomineeId) || null : null,
        voteCount: purchase.voteCount,
        usedVotes: purchase.usedVotes,
        status: purchase.status,
        paymentType: purchase.paymentType,
        totalAmount: decimalToNumber(purchase.totalAmount),
        adminFee: decimalToNumber(purchase.adminFee),
        qrisFee: decimalToNumber(purchase.qrisFee),
        grossAmount: decimalToNumber(purchase.grossAmount),
        organizerShareAmount: decimalToNumber(purchase.organizerShareAmount),
        organizerSharePercent: decimalToNumber(purchase.organizerSharePercent),
        paidAt: purchase.paidAt,
        createdAt: purchase.createdAt,
      })),
      total,
      page: pageNum,
      totalPages: Math.max(1, Math.ceil(total / limitNum)),
      summary: {
        totalRecords: total,
        paidTransactions: paidAgg._count,
        paidVotes: paidAgg._sum.voteCount || 0,
        paidRevenue: decimalToNumber(paidAgg._sum.totalAmount),
        organizerShare: decimalToNumber(paidAgg._sum.organizerShareAmount),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat riwayat transaksi', detail: error.message });
  }
});

router.get('/admin/event/:eventId/config', authenticate, canManageVoting, async (req, res) => {
  try {
    const eventId = toId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: 'ID event tidak valid' });
    if (!(await verifyEventOwnership(req, eventId))) return res.status(403).json({ error: 'Tidak memiliki akses ke event ini' });

    let config = await prisma.eventVotingConfig.findUnique({
      where: { rekomendasiEventId: eventId },
      include: includeConfig,
    });
    if (!config) {
      config = await prisma.eventVotingConfig.create({
        data: { rekomendasiEventId: eventId },
        include: includeConfig,
      });
    }
    res.json(normalizeVotingConfig(config));
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat konfigurasi voting', detail: error.message });
  }
});

router.put('/admin/event/:eventId/config', authenticate, canManageVoting, async (req, res) => {
  try {
    const eventId = toId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: 'ID event tidak valid' });
    if (!(await verifyEventOwnership(req, eventId))) return res.status(403).json({ error: 'Tidak memiliki akses ke event ini' });

    const existingConfig = await prisma.eventVotingConfig.findUnique({
      where: { rekomendasiEventId: eventId },
      select: { approvalStatus: true },
    });
    if (req.body.enabled && existingConfig?.approvalStatus !== 'APPROVED') {
      return res.status(400).json({
        error: 'E-voting belum disetujui FORBASI Pusat. Voting belum dapat diaktifkan.',
      });
    }

    const data = {
      enabled: !!req.body.enabled,
      isPaid: !!req.body.isPaid,
      pricePerVote: Number(req.body.pricePerVote) || 0,
      startDate: req.body.startDate ? new Date(req.body.startDate) : null,
      endDate: req.body.endDate ? new Date(req.body.endDate) : null,
    };

    const config = await prisma.eventVotingConfig.upsert({
      where: { rekomendasiEventId: eventId },
      create: { rekomendasiEventId: eventId, ...data },
      update: data,
      include: includeConfig,
    });

    res.json(normalizeVotingConfig(config));
  } catch (error) {
    res.status(500).json({ error: 'Gagal menyimpan konfigurasi voting', detail: error.message });
  }
});

router.post('/admin/event/:eventId/categories', authenticate, canManageVoting, async (req, res) => {
  try {
    const eventId = toId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: 'ID event tidak valid' });
    if (!(await verifyEventOwnership(req, eventId))) return res.status(403).json({ error: 'Tidak memiliki akses ke event ini' });
    if (!req.body.title?.trim()) return res.status(400).json({ error: 'Judul kategori wajib diisi' });

    const config = await prisma.eventVotingConfig.upsert({
      where: { rekomendasiEventId: eventId },
      create: { rekomendasiEventId: eventId },
      update: {},
    });

    const category = await prisma.votingCategory.create({
      data: {
        configId: config.id,
        title: req.body.title.trim(),
        description: req.body.description || null,
        mode: req.body.mode === 'PERSONAL' ? 'PERSONAL' : 'TEAM',
        position: req.body.position || null,
        order: Number.parseInt(req.body.order, 10) || 0,
      },
      include: { _count: { select: { nominees: true, votes: true } } },
    });
    res.status(201).json(category);
  } catch (error) {
    res.status(500).json({ error: 'Gagal membuat kategori voting', detail: error.message });
  }
});

router.put('/admin/categories/:categoryId', authenticate, canManageVoting, async (req, res) => {
  try {
    const categoryId = toId(req.params.categoryId);
    if (!categoryId) return res.status(400).json({ error: 'ID kategori tidak valid' });
    const eventId = await getEventIdForCategory(categoryId);
    if (!eventId) return res.status(404).json({ error: 'Kategori tidak ditemukan' });
    if (!(await verifyEventOwnership(req, eventId))) return res.status(403).json({ error: 'Tidak memiliki akses ke kategori ini' });

    const category = await prisma.votingCategory.update({
      where: { id: categoryId },
      data: {
        ...(req.body.title !== undefined && { title: req.body.title }),
        ...(req.body.description !== undefined && { description: req.body.description || null }),
        ...(req.body.mode !== undefined && { mode: req.body.mode === 'PERSONAL' ? 'PERSONAL' : 'TEAM' }),
        ...(req.body.position !== undefined && { position: req.body.position || null }),
        ...(req.body.isActive !== undefined && { isActive: !!req.body.isActive }),
        ...(req.body.order !== undefined && { order: Number.parseInt(req.body.order, 10) || 0 }),
      },
      include: { _count: { select: { nominees: true, votes: true } } },
    });
    res.json(category);
  } catch (error) {
    res.status(500).json({ error: 'Gagal memperbarui kategori', detail: error.message });
  }
});

router.delete('/admin/categories/:categoryId', authenticate, canManageVoting, async (req, res) => {
  try {
    const categoryId = toId(req.params.categoryId);
    if (!categoryId) return res.status(400).json({ error: 'ID kategori tidak valid' });
    const eventId = await getEventIdForCategory(categoryId);
    if (!eventId) return res.status(404).json({ error: 'Kategori tidak ditemukan' });
    if (!(await verifyEventOwnership(req, eventId))) return res.status(403).json({ error: 'Tidak memiliki akses ke kategori ini' });
    await prisma.votingCategory.delete({ where: { id: categoryId } });
    res.json({ message: 'Kategori voting berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menghapus kategori', detail: error.message });
  }
});

router.get('/admin/categories/:categoryId/nominees', authenticate, canManageVoting, async (req, res) => {
  try {
    const categoryId = toId(req.params.categoryId);
    if (!categoryId) return res.status(400).json({ error: 'ID kategori tidak valid' });
    const eventId = await getEventIdForCategory(categoryId);
    if (!eventId) return res.status(404).json({ error: 'Kategori tidak ditemukan' });
    if (!(await verifyEventOwnership(req, eventId))) return res.status(403).json({ error: 'Tidak memiliki akses ke kategori ini' });
    const nominees = await prisma.votingNominee.findMany({ where: { categoryId }, orderBy: { voteCount: 'desc' } });
    res.json(nominees);
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat nominee', detail: error.message });
  }
});

router.post('/admin/categories/:categoryId/nominees', authenticate, canManageVoting, upload.single('nomineePhoto'), async (req, res) => {
  try {
    const categoryId = toId(req.params.categoryId);
    if (!categoryId) return res.status(400).json({ error: 'ID kategori tidak valid' });
    const eventId = await getEventIdForCategory(categoryId);
    if (!eventId) return res.status(404).json({ error: 'Kategori tidak ditemukan' });
    if (!(await verifyEventOwnership(req, eventId))) return res.status(403).json({ error: 'Tidak memiliki akses ke kategori ini' });
    if (!req.body.nomineeName?.trim()) return res.status(400).json({ error: 'Nama nominee wajib diisi' });

    const nominee = await prisma.votingNominee.create({
      data: {
        categoryId,
        nomineeName: req.body.nomineeName.trim(),
        nomineeSubtitle: req.body.nomineeSubtitle || null,
        nomineePhoto: req.file ? `/uploads/${req.file.filename}` : req.body.nomineePhotoUrl || null,
      },
    });
    res.status(201).json(nominee);
  } catch (error) {
    res.status(500).json({ error: 'Gagal menambah nominee', detail: error.message });
  }
});

router.put('/admin/nominees/:nomineeId', authenticate, canManageVoting, upload.single('nomineePhoto'), async (req, res) => {
  try {
    const nomineeId = toId(req.params.nomineeId);
    if (!nomineeId) return res.status(400).json({ error: 'ID nominee tidak valid' });
    const eventId = await getEventIdForNominee(nomineeId);
    if (!eventId) return res.status(404).json({ error: 'Nominee tidak ditemukan' });
    if (!(await verifyEventOwnership(req, eventId))) return res.status(403).json({ error: 'Tidak memiliki akses ke nominee ini' });

    // Only touch fields that were actually sent, so a status toggle never wipes
    // the name/subtitle and an edit never changes the active flag.
    const data = {};
    if (req.body.nomineeName !== undefined) {
      const name = String(req.body.nomineeName).trim();
      if (!name) return res.status(400).json({ error: 'Nama nominee wajib diisi' });
      data.nomineeName = name;
    }
    if (req.body.nomineeSubtitle !== undefined) {
      data.nomineeSubtitle = String(req.body.nomineeSubtitle).trim() || null;
    }
    if (req.file) data.nomineePhoto = `/uploads/${req.file.filename}`;
    if (req.body.clearPhoto === 'true') data.nomineePhoto = null;
    if (req.body.isActive !== undefined) {
      data.isActive = req.body.isActive === true || req.body.isActive === 'true';
    }

    const nominee = await prisma.votingNominee.update({ where: { id: nomineeId }, data });
    res.json(nominee);
  } catch (error) {
    res.status(500).json({ error: 'Gagal memperbarui nominee', detail: error.message });
  }
});

// Nominees are never hard-deleted (votes/history must stay intact). Organizers
// deactivate them instead via PUT { isActive: false }.
router.delete('/admin/nominees/:nomineeId', authenticate, canManageVoting, async (req, res) => {
  return res.status(400).json({
    error: 'Nominee tidak dapat dihapus. Nonaktifkan nominee agar tidak tampil di voting publik.',
  });
});

router.get('/admin/event/:eventId/results', authenticate, canManageVoting, async (req, res) => {
  try {
    const eventId = toId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: 'ID event tidak valid' });
    if (!(await verifyEventOwnership(req, eventId))) return res.status(403).json({ error: 'Tidak memiliki akses ke event ini' });

    const config = await prisma.eventVotingConfig.findUnique({
      where: { rekomendasiEventId: eventId },
      include: includeConfig,
    });
    if (!config) return res.json({ categories: [], totalVotes: 0, pricePerVote: 0, isPaid: false });

    const totalVotes = config.categories.reduce((sum, category) => sum + category._count.votes, 0);
    res.json({
      categories: config.categories,
      totalVotes,
      pricePerVote: decimalToNumber(config.pricePerVote),
      isPaid: config.isPaid,
      approvalStatus: config.approvalStatus,
      organizerSharePercent: decimalToNumber(config.organizerSharePercent),
      pengdaSharePercent: decimalToNumber(config.pengdaSharePercent),
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat hasil voting', detail: error.message });
  }
});

// ==================== PENCAIRAN / WITHDRAWAL ====================

const withdrawalStatusLabel = {
  PENDING: 'Menunggu verifikasi',
  APPROVED: 'Disetujui, menunggu transfer',
  PAID: 'Dana sudah ditransfer',
  REJECTED: 'Ditolak',
};

const serializeWithdrawal = (item) => ({
  id: item.id,
  userId: item.userId,
  userName: item.user?.name || null,
  userEmail: item.user?.email || null,
  amount: decimalToNumber(item.amount),
  bankName: item.bankName,
  accountNumber: item.accountNumber,
  accountHolder: item.accountHolder,
  note: item.note,
  status: item.status,
  statusLabel: withdrawalStatusLabel[item.status] || item.status,
  adminNote: item.adminNote,
  processedById: item.processedById,
  processedAt: item.processedAt,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

// Compute spendable balance for a given user (organizer paid share minus non-rejected withdrawals)
const computeAvailableBalance = async (userId) => {
  const [paidAgg, withdrawalAgg] = await Promise.all([
    prisma.votingPurchase.aggregate({
      where: { status: 'PAID', event: { userId } },
      _sum: { organizerShareAmount: true },
    }),
    prisma.withdrawalRequest.aggregate({
      where: { userId, status: { in: ['PENDING', 'APPROVED', 'PAID'] } },
      _sum: { amount: true },
    }),
  ]);
  const organizerBalance = decimalToNumber(paidAgg._sum.organizerShareAmount);
  const reserved = decimalToNumber(withdrawalAgg._sum.amount);
  return { organizerBalance, reserved, availableBalance: Math.max(0, organizerBalance - reserved) };
};

// List withdrawals (own for penyelenggara, all for admin)
router.get('/admin/withdrawals', authenticate, canManageVoting, async (req, res) => {
  try {
    const isAdmin = isAdminRole(req.user.role);
    const where = isAdmin
      ? (req.query.status ? { status: req.query.status } : {})
      : { userId: req.user.id };
    const [withdrawals, balance] = await Promise.all([
      prisma.withdrawalRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { user: { select: { name: true, email: true } } },
      }),
      isAdmin ? Promise.resolve(null) : computeAvailableBalance(req.user.id),
    ]);
    res.json({
      withdrawals: withdrawals.map(serializeWithdrawal),
      balance,
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat data pencairan', detail: error.message });
  }
});

// Create a withdrawal request (penyelenggara/admin acting as organizer)
router.post('/admin/withdrawals', authenticate, canManageVoting, async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const bankName = String(req.body.bankName || '').trim();
    const accountNumber = String(req.body.accountNumber || '').trim();
    const accountHolder = String(req.body.accountHolder || '').trim();
    const note = String(req.body.note || '').trim();

    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Nominal pencairan tidak valid' });
    if (!bankName || !accountNumber || !accountHolder) {
      return res.status(400).json({ error: 'Nama bank, nomor rekening, dan atas nama wajib diisi' });
    }

    const { availableBalance } = await computeAvailableBalance(req.user.id);
    if (amount > availableBalance) {
      return res.status(400).json({ error: `Nominal melebihi saldo tersedia (${availableBalance})` });
    }

    const created = await prisma.withdrawalRequest.create({
      data: {
        userId: req.user.id,
        amount,
        bankName,
        accountNumber,
        accountHolder,
        note: note || null,
      },
      include: { user: { select: { name: true, email: true } } },
    });
    res.status(201).json({ message: 'Pengajuan pencairan dikirim', withdrawal: serializeWithdrawal(created) });
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengajukan pencairan', detail: error.message });
  }
});

// Cancel own pending withdrawal request
router.delete('/admin/withdrawals/:id', authenticate, canManageVoting, async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID tidak valid' });
    const existing = await prisma.withdrawalRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Pengajuan tidak ditemukan' });

    const isAdmin = isAdminRole(req.user.role);
    if (!isAdmin && existing.userId !== req.user.id) return res.status(403).json({ error: 'Tidak memiliki akses' });
    if (existing.status !== 'PENDING') return res.status(400).json({ error: 'Hanya pengajuan berstatus menunggu yang bisa dibatalkan' });

    await prisma.withdrawalRequest.delete({ where: { id } });
    res.json({ message: 'Pengajuan pencairan dibatalkan' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal membatalkan pencairan', detail: error.message });
  }
});

// Update withdrawal status (ADMIN only): approve / reject / mark paid
router.patch('/admin/withdrawals/:id', authenticate, async (req, res) => {
  try {
    if (!isAdminRole(req.user?.role)) return res.status(403).json({ error: 'Hanya admin yang dapat memproses pencairan' });
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID tidak valid' });
    const status = String(req.body.status || '').toUpperCase();
    if (!['APPROVED', 'REJECTED', 'PAID'].includes(status)) {
      return res.status(400).json({ error: 'Status tidak valid' });
    }
    const existing = await prisma.withdrawalRequest.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Pengajuan tidak ditemukan' });

    const updated = await prisma.withdrawalRequest.update({
      where: { id },
      data: {
        status,
        adminNote: req.body.adminNote ? String(req.body.adminNote).trim() : existing.adminNote,
        processedById: req.user.id,
        processedAt: new Date(),
      },
      include: { user: { select: { name: true, email: true } } },
    });
    res.json({ message: 'Status pencairan diperbarui', withdrawal: serializeWithdrawal(updated) });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memperbarui pencairan', detail: error.message });
  }
});

module.exports = router;
