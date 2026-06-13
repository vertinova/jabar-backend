const prisma = require('../lib/prisma');

const decimalToNumber = (value) => (value === null || value === undefined ? 0 : Number(value));

const normalizeConfig = (config) => config ? {
  ...config,
  pricePerVote: decimalToNumber(config.pricePerVote),
  organizerSharePercent: decimalToNumber(config.organizerSharePercent),
  pengdaSharePercent: decimalToNumber(config.pengdaSharePercent),
} : null;

const listEvents = async (req, res) => {
  try {
    const { search = '', approvalStatus } = req.query;
    const where = {};
    if (search) {
      where.OR = [
        { namaEvent: { contains: search } },
        { penyelenggara: { contains: search } },
        { user: { name: { contains: search } } },
      ];
    }
    if (approvalStatus) {
      where.votingConfig = { is: { approvalStatus } };
    }

    const events = await prisma.rekomendasiEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        votingConfig: {
          include: {
            categories: {
              include: { _count: { select: { nominees: true, votes: true } } },
            },
          },
        },
        _count: { select: { votingPurchases: true } },
      },
    });

    res.json(events.map((event) => ({
      ...event,
      votingConfig: normalizeConfig(event.votingConfig),
    })));
  } catch (error) {
    res.status(500).json({ error: 'Gagal memuat pengajuan e-voting', detail: error.message });
  }
};

const updateApproval = async (req, res) => {
  try {
    const eventId = Number.parseInt(req.params.eventId, 10);
    const approvalStatus = String(req.body.approvalStatus || '').toUpperCase();
    const validStatuses = ['PENDING', 'APPROVED', 'REJECTED'];
    if (!Number.isFinite(eventId)) return res.status(400).json({ error: 'ID event tidak valid' });
    if (!validStatuses.includes(approvalStatus)) {
      return res.status(400).json({ error: 'approvalStatus harus PENDING, APPROVED, atau REJECTED' });
    }

    const event = await prisma.rekomendasiEvent.findUnique({
      where: { id: eventId },
      select: { id: true, namaEvent: true },
    });
    if (!event) return res.status(404).json({ error: 'Event tidak ditemukan' });

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
          error: 'Persentase penyelenggara dan Pengda wajib bernilai 0-100 dan totalnya harus 100%',
        });
      }
    }

    const data = {
      approvalStatus,
      approvalNote: req.body.approvalNote || null,
      approvedAt: approvalStatus === 'APPROVED' ? new Date() : null,
      ...(Number.isFinite(organizerSharePercent) && { organizerSharePercent }),
      ...(Number.isFinite(pengdaSharePercent) && { pengdaSharePercent }),
      ...(approvalStatus !== 'APPROVED' && { enabled: false }),
    };

    const config = await prisma.eventVotingConfig.upsert({
      where: { rekomendasiEventId: eventId },
      create: { rekomendasiEventId: eventId, ...data },
      update: data,
      include: {
        categories: {
          include: { _count: { select: { nominees: true, votes: true } } },
        },
      },
    });

    res.json({
      message: `Status e-voting ${event.namaEvent} diperbarui menjadi ${approvalStatus}`,
      event: { ...event, votingConfig: normalizeConfig(config) },
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal memperbarui approval e-voting', detail: error.message });
  }
};

module.exports = { listEvents, updateApproval };
