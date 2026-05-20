const crypto = require('crypto');
const router = require('express').Router();
const prisma = require('../lib/prisma');
const upload = require('../middleware/upload.middleware');
const { authenticate } = require('../middleware/auth.middleware');
const {
  createSnapTransaction,
  getTransactionStatus,
  isMidtransConfigured,
  resolvePaymentStatus,
} = require('../lib/midtrans');
const {
  VOTING_MAX_ADMIN_FEE,
  applyPaidVotingPurchaseVotes,
  calculateVotingAdminFee,
} = require('../lib/votingPayment');

const optionalAuthenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return next();
  return authenticate(req, res, next);
};

const canManageVoting = (req, res, next) => {
  if (['ADMIN', 'PENYELENGGARA'].includes(req.user?.role)) return next();
  return res.status(403).json({ error: 'Akses ditolak' });
};

const toId = (value) => {
  const id = Number.parseInt(value, 10);
  return Number.isFinite(id) ? id : null;
};

const decimalToNumber = (value) => (value === null || value === undefined ? 0 : Number(value));

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
    votingConfig: event.votingConfig
      ? {
          ...event.votingConfig,
          pricePerVote: decimalToNumber(event.votingConfig.pricePerVote),
        }
      : null,
  };
};

const getClientIp = (req) =>
  req.headers['x-forwarded-for']?.toString().split(',')[0] ||
  req.socket.remoteAddress ||
  '';

const verifyEventOwnership = async (req, eventId) => {
  if (req.user?.role === 'ADMIN') return true;
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

  if (!category || category.config.rekomendasiEventId !== eventId || !category.isActive || !category.config.enabled || !category.config.isPaid) {
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
    where: { id: parsedNomineeId, categoryId: parsedCategoryId },
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
    return prisma.$transaction(async (tx) => {
      await tx.votingPurchase.update({
        where: { id: purchase.id },
        data: {
          status: 'PAID',
          paymentType: txStatus.payment_type || null,
          paidAt: new Date(),
        },
      });
      await applyPaidVotingPurchaseVotes(tx, purchase.id);
      return tx.votingPurchase.findUnique({ where: { id: purchase.id } });
    });
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
      votingConfig: { is: { enabled: true } },
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
      where: { id: eventId, status: 'DISETUJUI', votingConfig: { is: { enabled: true } } },
      include: {
        votingConfig: {
          include: {
            categories: {
              where: { isActive: true },
              orderBy: { order: 'asc' },
              include: { nominees: { orderBy: { voteCount: 'desc' } } },
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

    if (!category || !category.isActive || !category.config.enabled) {
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

    const nominee = await prisma.votingNominee.findFirst({ where: { id: nomineeId, categoryId } });
    if (!nominee) return res.status(404).json({ error: 'Nominee tidak ditemukan' });

    if (voterEmail) {
      const existingVotes = await prisma.votingVote.count({ where: { categoryId, voterEmail } });
      if (existingVotes >= category.maxVotesPerVoter) {
        return res.status(400).json({ error: `Anda sudah mencapai batas maksimal ${category.maxVotesPerVoter} vote untuk kategori ini` });
      }
    }

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
    if (!event || event.status !== 'DISETUJUI' || !config || !config.enabled || !config.isPaid) {
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
    const paymentAmount = totalAmount + adminFee;

    if (paymentAmount > QRIS_MAX_TRANSACTION) {
      const maxVotes = pricePerVote > 0
        ? Math.max(1, Math.floor((QRIS_MAX_TRANSACTION - VOTING_MAX_ADMIN_FEE) / pricePerVote))
        : 0;
      return res.status(400).json({
        error: `Maksimal pembayaran QRIS Rp ${QRIS_MAX_TRANSACTION.toLocaleString('id-ID')} per transaksi. Untuk event ini, jumlah vote maksimal ${maxVotes.toLocaleString('id-ID')} per pembelian.`,
        maxVoteCount: maxVotes,
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
        qrisFee,
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

router.get('/admin/events', authenticate, canManageVoting, async (req, res) => {
  try {
    const where = req.user.role === 'ADMIN' ? {} : { userId: req.user.id };
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
    res.json({ ...config, pricePerVote: decimalToNumber(config.pricePerVote) });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat konfigurasi voting', detail: error.message });
  }
});

router.put('/admin/event/:eventId/config', authenticate, canManageVoting, async (req, res) => {
  try {
    const eventId = toId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: 'ID event tidak valid' });
    if (!(await verifyEventOwnership(req, eventId))) return res.status(403).json({ error: 'Tidak memiliki akses ke event ini' });

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

    res.json({ ...config, pricePerVote: decimalToNumber(config.pricePerVote) });
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
        maxVotesPerVoter: Number.parseInt(req.body.maxVotesPerVoter, 10) || 1,
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
        ...(req.body.maxVotesPerVoter !== undefined && { maxVotesPerVoter: Number.parseInt(req.body.maxVotesPerVoter, 10) || 1 }),
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

    const data = {
      nomineeName: req.body.nomineeName,
      nomineeSubtitle: req.body.nomineeSubtitle || null,
    };
    if (req.file) data.nomineePhoto = `/uploads/${req.file.filename}`;
    if (req.body.clearPhoto === 'true') data.nomineePhoto = null;

    const nominee = await prisma.votingNominee.update({ where: { id: nomineeId }, data });
    res.json(nominee);
  } catch (error) {
    res.status(500).json({ error: 'Gagal memperbarui nominee', detail: error.message });
  }
});

router.delete('/admin/nominees/:nomineeId', authenticate, canManageVoting, async (req, res) => {
  try {
    const nomineeId = toId(req.params.nomineeId);
    if (!nomineeId) return res.status(400).json({ error: 'ID nominee tidak valid' });
    const eventId = await getEventIdForNominee(nomineeId);
    if (!eventId) return res.status(404).json({ error: 'Nominee tidak ditemukan' });
    if (!(await verifyEventOwnership(req, eventId))) return res.status(403).json({ error: 'Tidak memiliki akses ke nominee ini' });
    await prisma.votingNominee.delete({ where: { id: nomineeId } });
    res.json({ message: 'Nominee berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menghapus nominee', detail: error.message });
  }
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
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat hasil voting', detail: error.message });
  }
});

module.exports = router;
