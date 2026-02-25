const prisma = require('../lib/prisma');
const { fetchForbasiAccounts, fetchForbasiAccount, fixForbasiFileUrl } = require('../lib/forbasi');

// ── Simple in-memory cache for enriched anggota data ──
let anggotaCache = { data: null, timestamp: 0 };
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Helper: ensure anggota cache is populated (reused by landing & anggota endpoints)
const ensureAnggotaCache = async () => {
  if (anggotaCache.data && Date.now() - anggotaCache.timestamp < CACHE_TTL) {
    return anggotaCache.data;
  }
  try {
    const accounts = await fetchForbasiAccounts({ per_page: 500 });
    const BATCH_SIZE = 20;
    const enriched = [...accounts];
    for (let i = 0; i < enriched.length; i += BATCH_SIZE) {
      const batch = enriched.slice(i, i + BATCH_SIZE);
      const details = await Promise.allSettled(
        batch.map(a => fetchForbasiAccount(a.username))
      );
      details.forEach((result, idx) => {
        if (result.status === 'fulfilled' && result.value) {
          const detail = result.value;
          const kta = (detail.kta || [])[0];
          enriched[i + idx] = {
            ...enriched[i + idx],
            logo_url: fixForbasiFileUrl(enriched[i + idx].logo_url || (kta && kta.logo_url)),
            school_name: kta?.school_name || detail.school_name || null,
            coach_name: kta?.coach_name || null,
            leader_name: kta?.leader_name || null,
            club_address: kta?.club_address || detail.address || null,
            kta_status: kta?.status_label || null,
          };
        } else {
          enriched[i + idx].logo_url = fixForbasiFileUrl(enriched[i + idx].logo_url);
        }
      });
    }
    const result = enriched.filter(m => m.kta_status === 'KTA Terbit');
    anggotaCache = { data: result, timestamp: Date.now() };
    return result;
  } catch (err) {
    console.error('ensureAnggotaCache error:', err.message);
    return anggotaCache.data || [];
  }
};

const getStats = async (req, res) => {
  try {
    const [totalPengcab, totalRekomendasi, totalKejurda, totalPendaftaran, totalUsers] = await Promise.all([
      prisma.pengcab.count(),
      prisma.rekomendasiEvent.count(),
      prisma.kejurda.count(),
      prisma.pendaftaranKejurda.count(),
      prisma.user.count()
    ]);

    const rekomendasiByStatus = await prisma.rekomendasiEvent.groupBy({
      by: ['status'],
      _count: true
    });

    const pendaftaranByStatus = await prisma.pendaftaranKejurda.groupBy({
      by: ['status'],
      _count: true
    });

    const recentRekomendasi = await prisma.rekomendasiEvent.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { name: true } },
        pengcab: { select: { nama: true } }
      }
    });

    const recentPendaftaranRaw = await prisma.pendaftaranKejurda.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { name: true } },
        kejurda: { select: { namaKejurda: true } }
      }
    });
    const recentPendaftaran = recentPendaftaranRaw.map(p => ({
      ...p,
      user: p.user || { name: '-' },
    }));

    res.json({
      stats: { totalPengcab, totalRekomendasi, totalKejurda, totalPendaftaran, totalUsers },
      rekomendasiByStatus,
      pendaftaranByStatus,
      recentRekomendasi,
      recentPendaftaran
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil statistik', detail: error.message });
  }
};

// ── PUBLIC Landing Page Data (no auth) ──
const getLandingData = async (req, res) => {
  try {
    const [
      pengcabList,
      totalUsers,
      approvedEvents,
      openKejurda,
    ] = await Promise.all([
      // All active pengcab with structure
      prisma.pengcab.findMany({
        where: { status: 'AKTIF' },
        orderBy: { nama: 'asc' },
        select: {
          id: true, nama: true, kota: true, ketua: true,
          sekretaris: true, bendahara: true, alamat: true,
          phone: true, email: true, logo: true, forbasiId: true,
        }
      }),
      prisma.user.count(),
      // All approved rekomendasi events (recent 12)
      prisma.rekomendasiEvent.findMany({
        where: { status: 'DISETUJUI' },
        orderBy: { tanggalMulai: 'desc' },
        take: 12,
        select: {
          id: true, namaEvent: true, jenisEvent: true,
          tanggalMulai: true, tanggalSelesai: true,
          lokasi: true, deskripsi: true, penyelenggara: true,
          pengcab: { select: { nama: true, kota: true } }
        }
      }),
      // Open kejurda/kejurcab/events
      prisma.kejurda.findMany({
        where: { statusBuka: true, statusApproval: 'DISETUJUI' },
        orderBy: { tanggalMulai: 'asc' },
        select: {
          id: true, namaKejurda: true, jenisEvent: true, targetPeserta: true,
          tanggalMulai: true, tanggalSelesai: true,
          lokasi: true, deskripsi: true, poster: true,
          pengcabPengaju: { select: { nama: true, kota: true } }
        }
      }),
    ]);

    // Also get kejurda created by pengda (no pengcabId, admin-created) — these don't need approval
    const pengdaEvents = await prisma.kejurda.findMany({
      where: { pengcabId: null, statusBuka: true },
      orderBy: { tanggalMulai: 'asc' },
      select: {
        id: true, namaKejurda: true, jenisEvent: true, targetPeserta: true,
        tanggalMulai: true, tanggalSelesai: true,
        lokasi: true, deskripsi: true, poster: true,
      }
    });

    // Normalize pengcabPengaju → pengcab for frontend consistency
    const normalizeKejurda = (e) => {
      const { pengcabPengaju, ...rest } = e;
      return { ...rest, pengcab: pengcabPengaju || null };
    };

    // Merge and deduplicate events
    const allEventIds = new Set(openKejurda.map(e => e.id));
    const mergedEvents = openKejurda.map(normalizeKejurda);
    for (const e of pengdaEvents) {
      if (!allEventIds.has(e.id)) mergedEvents.push(normalizeKejurda(e));
    }
    mergedEvents.sort((a, b) => new Date(a.tanggalMulai) - new Date(b.tanggalMulai));

    // Fetch hero slides, active berita, site config, and struktur
    const [heroSlides, beritaList, siteConfigs, strukturList] = await Promise.all([
      prisma.heroSlide.findMany({ where: { aktif: true }, orderBy: { urutan: 'asc' } }),
      prisma.berita.findMany({ where: { aktif: true }, orderBy: { createdAt: 'desc' }, take: 6 }),
      prisma.siteConfig.findMany(),
      prisma.strukturOrganisasi.findMany({ where: { aktif: true }, orderBy: { urutan: 'asc' } }),
    ]);
    const config = {};
    siteConfigs.forEach(c => { config[c.key] = c.value; });

    // Get total club terdaftar (members with KTA Terbit) — fetch if cache empty
    const anggotaData = await ensureAnggotaCache();
    const totalClub = anggotaData.length;

    // Count unique kota/kabupaten from pengcab list
    const kotaSet = new Set(pengcabList.map(p => p.kota).filter(Boolean));

    res.json({
      stats: {
        totalPengcab: pengcabList.length,
        totalUsers,
        totalClub,
        totalEvents: mergedEvents.length + approvedEvents.length,
        kotaKabupaten: kotaSet.size || 27,
      },
      pengcabList,
      kejurdaEvents: mergedEvents,
      rekomendasiEvents: approvedEvents,
      heroSlides,
      beritaList,
      config,
      strukturList,
    });
  } catch (error) {
    console.error('Landing data error:', error);
    res.status(500).json({ error: 'Gagal memuat data landing page', detail: error.message });
  }
};

// ── PUBLIC Anggota FORBASI Data (no auth) ──
const getAnggotaForbasi = async (req, res) => {
  try {
    const { search } = req.query;

    let result = await ensureAnggotaCache();

    // Apply search filter if provided
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(m =>
        (m.club_name || '').toLowerCase().includes(q) ||
        (m.city_name || '').toLowerCase().includes(q) ||
        (m.school_name || '').toLowerCase().includes(q) ||
        (m.coach_name || '').toLowerCase().includes(q)
      );
    }

    res.json({ success: true, total: result.length, data: result });
  } catch (error) {
    console.error('Fetch anggota FORBASI error:', error);
    res.status(500).json({ error: 'Gagal memuat data anggota', detail: error.message });
  }
};

module.exports = { getStats, getLandingData, getAnggotaForbasi };
