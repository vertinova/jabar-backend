const prisma = require('../lib/prisma');
const { fetchForbasiAccounts, fetchForbasiAccount, fixForbasiFileUrl } = require('../lib/forbasi');

const nonVotingRecommendationWhere = {
  isManualRanking: false,
  OR: [
    { jenisEvent: null },
    { jenisEvent: { not: 'E-Voting' } },
  ],
};

const buildRankingStandings = (results) => {
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
      highlights: [],
    };

    current.totalPoints += result.points;
    current.totalResults += 1;
    if (!current.logo && result.logo) current.logo = result.logo;
    if (result.rank === 1) current.wins += 1;
    if (result.rank <= 3) current.podiums += 1;
    if (current.highlights.length < 3) {
      current.highlights.push({
        eventName: result.event?.namaEvent,
        category: result.category,
        title: result.title,
        points: result.points,
      });
    }
    map.set(key, current);
  }

  return Array.from(map.values())
    .sort((a, b) => b.totalPoints - a.totalPoints || b.wins - a.wins || b.podiums - a.podiums)
    .map((item, index) => ({ ...item, position: index + 1 }));
};

// ── Smart cache for enriched anggota data ──
// Cache invalidates when: TTL expires OR total count changes OR force refresh.
// Kept short so club baru dari API muncul mendekati realtime di landing. Saat TTL
// habis dan jumlah club TIDAK berubah, refresh hanya 1x fetch daftar akun (murah);
// enrichment berat hanya jalan ketika ada penambahan club.
const ANGGOTA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let anggotaCache = { 
  data: null, 
  lastTotal: 0, 
  lastFetch: 0,
  CACHE_TTL: ANGGOTA_CACHE_TTL
};
let anggotaRefreshPromise = null;

// Current year for KTA filter (only show KTA issued in current year)
const CURRENT_YEAR = new Date().getFullYear().toString(); // "2026"

const firstValue = (...values) => values.find(value => typeof value === 'string' && value.trim());

const getForbasiLogoUrl = (account = {}, kta = {}) => fixForbasiFileUrl(firstValue(
  account.logo_url,
  account.logoUrl,
  account.logo,
  account.club_logo_url,
  account.clubLogoUrl,
  account.club_logo,
  account.clubLogo,
  account.avatar,
  account.photo_url,
  account.image_url,
  kta.logo_url,
  kta.logoUrl,
  kta.logo,
  kta.club_logo_url,
  kta.clubLogoUrl,
  kta.club_logo,
  kta.clubLogo,
  kta.photo_url,
  kta.image_url
));

// Helper: ensure anggota cache is populated
// Auto-refresh when: TTL expired, new member detected, or force refresh
const ensureAnggotaCache = async (forceRefresh = false) => {
  try {
    const now = Date.now();
    const cacheExpired = !anggotaCache.lastFetch || (now - anggotaCache.lastFetch) > anggotaCache.CACHE_TTL;
    
    // Return cached data if valid and not expired (unless force refresh)
    if (!forceRefresh && !cacheExpired && anggotaCache.data) {
      return anggotaCache.data;
    }

    if (anggotaRefreshPromise) {
      return await anggotaRefreshPromise;
    }

    anggotaRefreshPromise = (async () => {
    
    // Fetch all USER accounts from API (with pagination)
    const accounts = await fetchForbasiAccounts({ role: 'user', per_page: 200 });
    if (!accounts.length) {
      if (anggotaCache.data) return anggotaCache.data;
      throw new Error('FORBASI accounts API returned empty data');
    }

    const currentTotal = accounts.length;
    const hasNewData = currentTotal !== anggotaCache.lastTotal;
    
    // If only TTL expired (no new members), just refresh timestamp and return cached
    if (!forceRefresh && !hasNewData && anggotaCache.data) {
      anggotaCache.lastFetch = now;
      return anggotaCache.data;
    }
    
    // New data detected or force refresh - enrich the accounts
    const BATCH_SIZE = 20;
    const enriched = [];
    
    for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
      const batch = accounts.slice(i, i + BATCH_SIZE);
      const details = await Promise.allSettled(
        batch.map(a => fetchForbasiAccount(a.username || a.id))
      );
      
      details.forEach((result, idx) => {
        const account = batch[idx];
        if (result.status === 'fulfilled' && result.value) {
          const detail = result.value;
          // Find KTA that:
          // 1. Has status 'KTA Terbit'
          // 2. Issued in current year (2026)
          // 3. Province is 'Jawa Barat'
          const ktaList = detail.kta || [];
          const validKta = ktaList.find(k => {
            if (!k || k.status_label !== 'KTA Terbit') return false;
            // Check year from kta_issued_at (format: "2026-02-21 08:44:48")
            const issuedYear = k.kta_issued_at ? k.kta_issued_at.substring(0, 4) : null;
            if (issuedYear !== CURRENT_YEAR) return false;
            // Check province
            if (k.province !== 'Jawa Barat') return false;
            return true;
          });
          
          // Only add if has valid KTA Terbit for current year
          if (validKta) {
            enriched.push({
              ...account,
              logo_url: getForbasiLogoUrl(account, validKta),
              school_name: validKta.school_name || detail.school_name || null,
              coach_name: validKta.coach_name || null,
              leader_name: validKta.leader_name || null,
              club_address: validKta.club_address || detail.address || null,
              kta_status: validKta.status_label,
              kta_number: validKta.kta_id || null,
              kta_issued_at: validKta.kta_issued_at || null,
            });
          }
        }
      });
    }
    
    // Store result with timestamp for TTL tracking
    anggotaCache = { 
      data: enriched, 
      lastTotal: accounts.length, 
      lastFetch: Date.now(),
      CACHE_TTL: ANGGOTA_CACHE_TTL
    };
    console.log(`Anggota cache refreshed: ${enriched.length} with KTA Terbit ${CURRENT_YEAR} out of ${accounts.length} total accounts`);
    return enriched;
    })();

    try {
      return await anggotaRefreshPromise;
    } finally {
      anggotaRefreshPromise = null;
    }
  } catch (err) {
    console.error('ensureAnggotaCache error:', err.message);
    return anggotaCache.data || [];
  }
};

const getStats = async (req, res) => {
  try {
    const [totalPengcab, totalRekomendasi, totalKejurda, totalPendaftaran, totalUsers] = await Promise.all([
      prisma.pengcab.count(),
      prisma.rekomendasiEvent.count({ where: nonVotingRecommendationWhere }),
      prisma.kejurda.count(),
      prisma.pendaftaranKejurda.count(),
      prisma.user.count()
    ]);

    const rekomendasiByStatus = await prisma.rekomendasiEvent.groupBy({
      by: ['status'],
      where: nonVotingRecommendationWhere,
      _count: true
    });

    const pendaftaranByStatus = await prisma.pendaftaranKejurda.groupBy({
      by: ['status'],
      _count: true
    });

    const recentRekomendasi = await prisma.rekomendasiEvent.findMany({
      where: nonVotingRecommendationWhere,
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
        where: { status: 'DISETUJUI', suratRekomendasi: { not: null }, isManualRanking: false },
        orderBy: { tanggalMulai: 'desc' },
        take: 12,
        select: {
          id: true, namaEvent: true, jenisEvent: true,
          tanggalMulai: true, tanggalSelesai: true,
          lokasi: true, deskripsi: true, penyelenggara: true,
          poster: true, suratRekomendasi: true,
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
          lokasi: true, deskripsi: true, poster: true, suratRekomendasi: true,
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
        lokasi: true, deskripsi: true, poster: true, suratRekomendasi: true,
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

    const rankingResults = await prisma.rankingResult.findMany({
      where: { event: { status: 'DISETUJUI', suratRekomendasi: { not: null } } },
      orderBy: [{ points: 'desc' }, { createdAt: 'desc' }],
      include: {
        event: { select: { id: true, namaEvent: true, tanggalMulai: true } },
      },
    });
    // Klasemen dipisah per mata lomba (default LOBB).
    const MATA_LOMBA = ['LOBB', 'RUKIBRA'];
    const rankingByMataLomba = {};
    for (const ml of MATA_LOMBA) {
      rankingByMataLomba[ml] = buildRankingStandings(
        rankingResults.filter((r) => (r.mataLomba || 'LOBB') === ml)
      ).slice(0, 10);
    }
    const rankingStandings = rankingByMataLomba.LOBB;

    res.json({
      stats: {
        totalPengcab: pengcabList.length,
        totalUsers,
        totalClub,
        totalAnggota: totalClub,
        totalMembers: totalClub,
        totalEvents: mergedEvents.length + approvedEvents.length,
        kotaKabupaten: kotaSet.size || 27,
        rankingParticipants: rankingStandings.length,
      },
      pengcabList,
      kejurdaEvents: mergedEvents,
      rekomendasiEvents: approvedEvents,
      heroSlides,
      beritaList,
      config,
      strukturList,
      rankingStandings,
      rankingByMataLomba,
    });
  } catch (error) {
    console.error('Landing data error:', error);
    res.status(500).json({ error: 'Gagal memuat data landing page', detail: error.message });
  }
};

// ── PUBLIC Anggota FORBASI Data (no auth) ──
// Auto-refreshes when: TTL expires, new member detected, or refresh=true
const getPublicEvents = async (req, res) => {
  try {
    const [approvedEvents, openKejurda, pengdaEvents] = await Promise.all([
      prisma.rekomendasiEvent.findMany({
        where: { status: 'DISETUJUI', suratRekomendasi: { not: null }, isManualRanking: false },
        orderBy: { tanggalMulai: 'desc' },
        select: {
          id: true, namaEvent: true, jenisEvent: true,
          tanggalMulai: true, tanggalSelesai: true,
          lokasi: true, deskripsi: true, penyelenggara: true,
          poster: true, suratRekomendasi: true,
          pengcab: { select: { nama: true, kota: true } }
        }
      }),
      prisma.kejurda.findMany({
        where: { statusBuka: true, statusApproval: 'DISETUJUI' },
        orderBy: { tanggalMulai: 'asc' },
        select: {
          id: true, namaKejurda: true, jenisEvent: true, targetPeserta: true,
          tanggalMulai: true, tanggalSelesai: true,
          lokasi: true, deskripsi: true, poster: true, suratRekomendasi: true,
          pengcabPengaju: { select: { nama: true, kota: true } }
        }
      }),
      prisma.kejurda.findMany({
        where: { pengcabId: null, statusBuka: true },
        orderBy: { tanggalMulai: 'asc' },
        select: {
          id: true, namaKejurda: true, jenisEvent: true, targetPeserta: true,
          tanggalMulai: true, tanggalSelesai: true,
          lokasi: true, deskripsi: true, poster: true, suratRekomendasi: true,
        }
      }),
    ]);

    const eventIds = new Set(openKejurda.map(e => e.id));
    const events = [
      ...openKejurda.map(e => ({
        id: `k-${e.id}`,
        sourceId: e.id,
        name: e.namaKejurda,
        type: e.jenisEvent,
        targetPeserta: e.targetPeserta || 'CLUB',
        start: e.tanggalMulai,
        end: e.tanggalSelesai,
        location: e.lokasi,
        desc: e.deskripsi,
        poster: e.poster,
        suratRekomendasi: e.suratRekomendasi,
        org: e.pengcabPengaju?.nama || 'Pengda Jabar',
      })),
      ...pengdaEvents.filter(e => !eventIds.has(e.id)).map(e => ({
        id: `k-${e.id}`,
        sourceId: e.id,
        name: e.namaKejurda,
        type: e.jenisEvent,
        targetPeserta: e.targetPeserta || 'CLUB',
        start: e.tanggalMulai,
        end: e.tanggalSelesai,
        location: e.lokasi,
        desc: e.deskripsi,
        poster: e.poster,
        suratRekomendasi: e.suratRekomendasi,
        org: 'Pengda Jabar',
      })),
      ...approvedEvents.map(e => ({
        id: `r-${e.id}`,
        sourceId: e.id,
        name: e.namaEvent,
        type: e.jenisEvent || 'EVENT_REGULER',
        targetPeserta: 'INFO',
        start: e.tanggalMulai,
        end: e.tanggalSelesai,
        location: e.lokasi,
        desc: e.deskripsi,
        poster: e.poster,
        suratRekomendasi: e.suratRekomendasi,
        org: e.penyelenggara || e.pengcab?.nama || '-',
      })),
    ].sort((a, b) => new Date(b.start) - new Date(a.start));

    res.json({ success: true, total: events.length, data: events });
  } catch (error) {
    console.error('Public events error:', error);
    res.status(500).json({ error: 'Gagal memuat data agenda', detail: error.message });
  }
};

const getAnggotaForbasi = async (req, res) => {
  try {
    const { search, refresh } = req.query;
    const forceRefresh = refresh === 'true';

    let result = await ensureAnggotaCache(forceRefresh);

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

    res.json({ 
      success: true, 
      total: result.length, 
      cacheAge: anggotaCache.lastFetch ? Math.round((Date.now() - anggotaCache.lastFetch) / 1000) : 0,
      data: result 
    });
  } catch (error) {
    console.error('Fetch anggota FORBASI error:', error);
    res.status(500).json({ error: 'Gagal memuat data anggota', detail: error.message });
  }
};

// ── Clear anggota cache (admin only) ──
const clearAnggotaCache = async (req, res) => {
  anggotaRefreshPromise = null;
  anggotaCache = { data: null, lastTotal: 0, lastFetch: 0, CACHE_TTL: ANGGOTA_CACHE_TTL };
  res.json({ success: true, message: 'Cache anggota berhasil di-clear, akan refresh otomatis pada request berikutnya' });
};

module.exports = { getStats, getLandingData, getPublicEvents, getAnggotaForbasi, clearAnggotaCache };
