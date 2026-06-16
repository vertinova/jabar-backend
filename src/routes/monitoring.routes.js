const crypto = require('crypto');
const router = require('express').Router();
const prisma = require('../lib/prisma');
const presence = require('../lib/presence');
const { authenticate } = require('../middleware/auth.middleware');

const optionalAuthenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return next();
  return authenticate(req, res, next);
};

const isAdminLike = (req, res, next) => {
  if (['ADMIN', 'SUPERADMIN'].includes(req.user?.role)) return next();
  return res.status(403).json({ error: 'Akses ditolak' });
};

const getClientIp = (req) =>
  req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
  req.socket?.remoteAddress ||
  '';

const detectDevice = (ua = '') => {
  if (/ipad|tablet|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|android|iphone|ipod|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
  return 'desktop';
};

const decimalToNumber = (value) => (value === null || value === undefined ? 0 : Number(value));

// Public heartbeat — any visitor (guest or logged in) reports their presence.
router.post('/heartbeat', optionalAuthenticate, (req, res) => {
  const ua = req.headers['user-agent'] || '';
  const ip = getClientIp(req);
  const visitorId = String(req.body.visitorId || '').slice(0, 64)
    || crypto.createHash('sha1').update(ip + ua).digest('hex').slice(0, 16);
  const key = req.user ? `u:${req.user.id}` : `v:${visitorId}`;

  presence.touch({
    key,
    userId: req.user?.id || null,
    name: req.user?.name || null,
    role: req.user?.role || 'GUEST',
    page: String(req.body.page || '/').slice(0, 200),
    device: detectDevice(ua),
    ip,
  });
  res.json({ ok: true });
});

// Live monitoring snapshot — superadmin / admin only.
router.get('/live', authenticate, isAdminLike, async (req, res) => {
  try {
    const visitors = presence.active();

    const byRole = {};
    const byDevice = { mobile: 0, desktop: 0, tablet: 0 };
    const byPage = {};
    let loggedIn = 0;
    let guests = 0;
    for (const v of visitors) {
      byRole[v.role] = (byRole[v.role] || 0) + 1;
      byDevice[v.device] = (byDevice[v.device] || 0) + 1;
      byPage[v.page] = (byPage[v.page] || 0) + 1;
      if (v.userId) loggedIn += 1; else guests += 1;
    }

    const onlineList = visitors
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, 50)
      .map((v) => ({
        name: v.name || 'Tamu',
        role: v.role,
        page: v.page,
        device: v.device,
        lastSeen: v.lastSeen,
        guest: !v.userId,
      }));

    const topPages = Object.entries(byPage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([page, count]) => ({ page, count }));

    const hourAgo = new Date(Date.now() - 3600 * 1000);

    // E-Voting transaction stats (the app's paid flow).
    const [pendingNow, paidHour, failedHour, revenueHour, votingByStatus, recent] = await Promise.all([
      prisma.votingPurchase.count({ where: { status: 'PENDING' } }),
      prisma.votingPurchase.count({ where: { status: 'PAID', paidAt: { gte: hourAgo } } }),
      prisma.votingPurchase.count({ where: { status: { in: ['CANCELLED', 'EXPIRED'] }, updatedAt: { gte: hourAgo } } }),
      prisma.votingPurchase.aggregate({ where: { status: 'PAID', paidAt: { gte: hourAgo } }, _sum: { totalAmount: true } }),
      prisma.votingPurchase.groupBy({ by: ['status'], _count: true }),
      prisma.votingPurchase.findMany({
        orderBy: { createdAt: 'desc' },
        take: 12,
        include: { event: { select: { namaEvent: true } } },
      }),
    ]);

    const statusCount = (s) => votingByStatus.find((x) => x.status === s)?._count || 0;
    const votingSukses = statusCount('PAID');
    const votingPending = statusCount('PENDING');
    const votingGagal = statusCount('CANCELLED') + statusCount('EXPIRED');

    res.json({
      now: Date.now(),
      presence: {
        online: visitors.length,
        loggedIn,
        guests,
        byRole,
        byDevice,
        topPages,
        list: onlineList,
      },
      transactions: {
        pendingNow,
        paidHour,
        failedHour,
        revenueHour: decimalToNumber(revenueHour._sum.totalAmount),
        categories: [
          { key: 'E-Voting', sukses: votingSukses, pending: votingPending, gagal: votingGagal },
        ],
        recent: recent.map((p) => ({
          id: p.id,
          buyerName: p.buyerName,
          eventName: p.event?.namaEvent || null,
          voteCount: p.voteCount,
          amount: decimalToNumber(p.totalAmount),
          status: p.status,
          createdAt: p.createdAt,
          paidAt: p.paidAt,
        })),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat data monitoring', detail: error.message });
  }
});

module.exports = router;
