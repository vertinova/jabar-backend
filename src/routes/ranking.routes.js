const router = require('express').Router();
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth.middleware');

const DEFAULT_POINTS = {
  1: 100,
  2: 70,
  3: 50,
  4: 30,
  5: 20,
  6: 10,
};

const normalizeParticipantKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const toId = (value) => {
  const id = Number.parseInt(value, 10);
  return Number.isFinite(id) ? id : null;
};

const titleFromRank = (rank) => {
  if (rank === 1) return 'Juara 1';
  if (rank === 2) return 'Juara 2';
  if (rank === 3) return 'Juara 3';
  if (rank === 4) return 'Harapan 1';
  if (rank === 5) return 'Harapan 2';
  if (rank === 6) return 'Harapan 3';
  return `Peringkat ${rank}`;
};

const canManageRanking = async (req, eventId) => {
  // ADMIN & KOMPER (Komisi Perlombaan) boleh mengelola hasil ranking semua event.
  if (req.user?.role === 'ADMIN' || req.user?.role === 'KOMPER') return true;
  if (req.user?.role !== 'PENYELENGGARA') return false;

  const event = await prisma.rekomendasiEvent.findUnique({
    where: { id: eventId },
    select: { userId: true },
  });
  return event?.userId === req.user.id;
};

const buildStandings = (results) => {
  const map = new Map();

  for (const result of results) {
    const key = result.participantKey;
    const current = map.get(key) || {
      participantName: result.participantName,
      participantKey: key,
      participantType: result.participantType,
      origin: result.origin,
      totalPoints: 0,
      totalResults: 0,
      wins: 0,
      podiums: 0,
      latestResultAt: result.createdAt,
      highlights: [],
    };

    current.totalPoints += result.points;
    current.totalResults += 1;
    if (result.rank === 1) current.wins += 1;
    if (result.rank <= 3) current.podiums += 1;
    if (!current.latestResultAt || result.createdAt > current.latestResultAt) current.latestResultAt = result.createdAt;
    if (current.highlights.length < 4) {
      current.highlights.push({
        id: result.id,
        eventId: result.rekomendasiEventId,
        eventName: result.event?.namaEvent,
        eventDate: result.event?.tanggalMulai,
        category: result.category,
        rank: result.rank,
        title: result.title || titleFromRank(result.rank),
        points: result.points,
      });
    }

    map.set(key, current);
  }

  return Array.from(map.values())
    .sort((a, b) =>
      b.totalPoints - a.totalPoints ||
      b.wins - a.wins ||
      b.podiums - a.podiums ||
      new Date(b.latestResultAt) - new Date(a.latestResultAt)
    )
    .map((item, index) => ({ ...item, position: index + 1 }));
};

router.get('/standings', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const year = Number.parseInt(req.query.year, 10);
    const where = {
      event: { status: 'DISETUJUI', suratRekomendasi: { not: null } },
    };

    if (Number.isFinite(year)) {
      where.event.tanggalMulai = {
        gte: new Date(Date.UTC(year, 0, 1)),
        lt: new Date(Date.UTC(year + 1, 0, 1)),
      };
    }

    const results = await prisma.rankingResult.findMany({
      where,
      orderBy: [{ points: 'desc' }, { createdAt: 'desc' }],
      include: {
        event: {
          select: {
            id: true,
            namaEvent: true,
            tanggalMulai: true,
            lokasi: true,
            penyelenggara: true,
          },
        },
      },
    });

    res.json({
      data: buildStandings(results).slice(0, limit),
      totalParticipants: new Set(results.map((item) => item.participantKey)).size,
      totalResults: results.length,
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat ranking', detail: error.message });
  }
});

router.get('/recent-results', async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
    const results = await prisma.rankingResult.findMany({
      where: { event: { status: 'DISETUJUI', suratRekomendasi: { not: null } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        event: { select: { id: true, namaEvent: true, tanggalMulai: true, lokasi: true } },
      },
    });
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat hasil terbaru', detail: error.message });
  }
});

router.get('/organizer/events', authenticate, async (req, res) => {
  try {
    if (!['ADMIN', 'KOMPER', 'PENYELENGGARA'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Akses ditolak' });
    }

    // ADMIN & KOMPER melihat semua event terekomendasi; PENYELENGGARA hanya miliknya.
    const where = {
      status: 'DISETUJUI',
      suratRekomendasi: { not: null },
      ...(req.user.role === 'PENYELENGGARA' ? { userId: req.user.id } : {}),
    };

    const events = await prisma.rekomendasiEvent.findMany({
      where,
      orderBy: { tanggalMulai: 'desc' },
      select: {
        id: true,
        namaEvent: true,
        jenisEvent: true,
        tanggalMulai: true,
        lokasi: true,
        penyelenggara: true,
        _count: { select: { rankingResults: true } },
      },
    });

    res.json(events);
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat event ranking', detail: error.message });
  }
});

router.get('/organizer/event/:eventId/results', authenticate, async (req, res) => {
  try {
    const eventId = toId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: 'ID event tidak valid' });
    if (!(await canManageRanking(req, eventId))) return res.status(403).json({ error: 'Tidak memiliki akses ke event ini' });

    const results = await prisma.rankingResult.findMany({
      where: { rekomendasiEventId: eventId },
      orderBy: [{ category: 'asc' }, { rank: 'asc' }, { createdAt: 'asc' }],
    });

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat hasil ranking', detail: error.message });
  }
});

router.post('/organizer/event/:eventId/results', authenticate, async (req, res) => {
  try {
    const eventId = toId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: 'ID event tidak valid' });
    if (!(await canManageRanking(req, eventId))) return res.status(403).json({ error: 'Tidak memiliki akses ke event ini' });

    const event = await prisma.rekomendasiEvent.findUnique({
      where: { id: eventId },
      select: { status: true, suratRekomendasi: true },
    });
    if (!event || event.status !== 'DISETUJUI' || !event.suratRekomendasi) {
      return res.status(400).json({ error: 'Hasil hanya bisa diinput untuk event yang sudah memiliki surat rekomendasi' });
    }

    const participantName = String(req.body.participantName || '').trim();
    const category = String(req.body.category || '').trim();
    const origin = String(req.body.origin || '').trim();
    const participantType = ['TEAM', 'INDIVIDUAL'].includes(req.body.participantType) ? req.body.participantType : 'TEAM';
    const rank = Number.parseInt(req.body.rank, 10);
    const points = req.body.points === undefined || req.body.points === ''
      ? DEFAULT_POINTS[rank] || 0
      : Number.parseInt(req.body.points, 10);

    if (!participantName) return res.status(400).json({ error: 'Nama peserta/tim wajib diisi' });
    if (!category) return res.status(400).json({ error: 'Kategori lomba wajib diisi' });
    if (!Number.isInteger(rank) || rank < 1) return res.status(400).json({ error: 'Peringkat tidak valid' });
    if (!Number.isInteger(points) || points < 0) return res.status(400).json({ error: 'Poin tidak valid' });

    const result = await prisma.rankingResult.create({
      data: {
        rekomendasiEventId: eventId,
        participantName,
        participantKey: normalizeParticipantKey(participantName),
        participantType,
        origin: origin || null,
        category,
        rank,
        title: req.body.title?.trim() || titleFromRank(rank),
        points,
        notes: req.body.notes?.trim() || null,
        createdById: req.user.id,
      },
    });

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: 'Gagal menyimpan hasil ranking', detail: error.message });
  }
});

router.put('/organizer/results/:id', authenticate, async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID hasil tidak valid' });

    const existing = await prisma.rankingResult.findUnique({
      where: { id },
      select: { rekomendasiEventId: true },
    });
    if (!existing) return res.status(404).json({ error: 'Hasil tidak ditemukan' });
    if (!(await canManageRanking(req, existing.rekomendasiEventId))) return res.status(403).json({ error: 'Akses ditolak' });

    const participantName = req.body.participantName !== undefined ? String(req.body.participantName).trim() : undefined;
    const rank = req.body.rank !== undefined ? Number.parseInt(req.body.rank, 10) : undefined;
    const points = req.body.points !== undefined ? Number.parseInt(req.body.points, 10) : undefined;

    const result = await prisma.rankingResult.update({
      where: { id },
      data: {
        ...(participantName !== undefined && {
          participantName,
          participantKey: normalizeParticipantKey(participantName),
        }),
        ...(req.body.participantType !== undefined && {
          participantType: ['TEAM', 'INDIVIDUAL'].includes(req.body.participantType) ? req.body.participantType : 'TEAM',
        }),
        ...(req.body.origin !== undefined && { origin: String(req.body.origin || '').trim() || null }),
        ...(req.body.category !== undefined && { category: String(req.body.category || '').trim() }),
        ...(rank !== undefined && Number.isInteger(rank) && { rank, title: req.body.title?.trim() || titleFromRank(rank) }),
        ...(points !== undefined && Number.isInteger(points) && { points }),
        ...(req.body.notes !== undefined && { notes: String(req.body.notes || '').trim() || null }),
      },
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Gagal memperbarui hasil ranking', detail: error.message });
  }
});

router.delete('/organizer/results/:id', authenticate, async (req, res) => {
  try {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID hasil tidak valid' });

    const existing = await prisma.rankingResult.findUnique({
      where: { id },
      select: { rekomendasiEventId: true },
    });
    if (!existing) return res.status(404).json({ error: 'Hasil tidak ditemukan' });
    if (!(await canManageRanking(req, existing.rekomendasiEventId))) return res.status(403).json({ error: 'Akses ditolak' });

    await prisma.rankingResult.delete({ where: { id } });
    res.json({ message: 'Hasil ranking berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menghapus hasil ranking', detail: error.message });
  }
});

module.exports = router;
