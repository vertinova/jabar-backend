/**
 * Voter feed — daftar semua voter sebuah event beserta pesan dukungannya,
 * dipakai untuk ticker berjalan & popup di halaman voting publik.
 *
 * Dua alasan modul ini ada (bukan query langsung di route):
 *
 * 1. Agregasi di DB, bukan di Node. Versi lama menarik SELURUH baris
 *    votingVote (puluhan ribu) lengkap dengan join kategori+nominee+purchase
 *    hanya untuk menghitung top 3. Di sini semua hitungan dilakukan lewat
 *    groupBy, lalu nama kategori/nominee ditempel dari lookup kecil.
 *
 * 2. Cache in-memory ber-TTL. Ticker dibaca setiap pengunjung membuka halaman,
 *    jadi tanpa cache endpoint ini akan memukul DB yang sama yang sedang
 *    melayani vote yang berlangsung. TTL pendek + invalidasi eksplisit saat ada
 *    vote baru membuatnya tetap terasa real-time.
 *
 * Catatan: cache bersifat per-proses. Kalau backend dijalankan pm2 cluster,
 * tiap worker punya cache sendiri — staleness tetap terbatas oleh TTL.
 */

const crypto = require('crypto');

const prisma = require('./prisma');

const VOTERS_CACHE_TTL = 20_000; // 20 detik
const VOTERS_LIMIT = 60; // maksimum voter yang dikirim ke ticker
const CACHE_MAX_ENTRIES = 200; // batasi agar tidak tumbuh tak terbatas

/** @type {Map<number, { expires: number, voters: object[] }>} */
const votersCache = new Map();

const invalidateEventVoters = (eventId) => {
  const id = Number(eventId);
  if (Number.isInteger(id)) votersCache.delete(id);
};

/**
 * Versi aman untuk dipanggil dari jalur tulis (vote / settlement pembayaran).
 * Cache hanyalah optimasi baca — kegagalan di sini tidak boleh pernah
 * menggagalkan vote atau pembayaran yang sedang diproses.
 */
const invalidateEventVotersSafe = (eventId) => {
  try {
    invalidateEventVoters(eventId);
  } catch (error) {
    console.warn('[voters] gagal invalidate cache:', error.message);
  }
};

const pruneCache = () => {
  if (votersCache.size <= CACHE_MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of votersCache) {
    if (entry.expires <= now) votersCache.delete(key);
  }
  // Masih penuh setelah membuang yang kedaluwarsa — buang yang tertua.
  while (votersCache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = votersCache.keys().next().value;
    if (oldestKey === undefined) break;
    votersCache.delete(oldestKey);
  }
};

/**
 * Kunci identitas voter, dinormalkan.
 *
 * Penting: collation MySQL default bersifat case-insensitive, sehingga
 * groupBy di DB sudah menggabung "Man" dan "MAN". Penggabungan lanjutan di JS
 * harus mengikuti aturan yang sama — kalau tidak, satu orang terpecah menjadi
 * beberapa voter saat menulis namanya dengan kapitalisasi berbeda.
 */
const voterKey = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized || null;
};

/**
 * Ubah hasil groupBy menjadi daftar voter.
 * `keyOf` menentukan identitas voter: nomor HP pembeli (berbayar) atau nama
 * voter (gratis). `enrich` menambahkan nama & pesan dari data pembelian.
 */
const foldGroups = (groups, { keyOf, enrich, categoryTitle, nomineeName }) => {
  const voters = new Map();

  for (const group of groups) {
    const key = keyOf(group);
    if (key === null || key === undefined || key === '') continue;

    const count = group._count?._all || 0;
    if (!count) continue;

    let voter = voters.get(key);
    if (!voter) {
      voter = { key: String(key), name: 'Anonim', message: '', voteCount: 0, votedAt: null, details: new Map() };
      voters.set(key, voter);
    }

    voter.voteCount += count;

    const votedAt = group._max?.createdAt || null;
    if (votedAt && (!voter.votedAt || votedAt > voter.votedAt)) voter.votedAt = votedAt;

    const category = categoryTitle.get(group.categoryId) || 'Tanpa kategori';
    const nominee = nomineeName.get(group.nomineeId) || 'Tanpa nominee';
    const detailKey = `${category}|${nominee}`;
    const detail = voter.details.get(detailKey) || { category, nominee, voteCount: 0 };
    detail.voteCount += count;
    voter.details.set(detailKey, detail);

    enrich(voter, group);
  }

  return Array.from(voters.values()).map((voter) => ({
    // Kunci pengelompokan adalah nomor HP pembeli (voting berbayar), dan
    // endpoint ini publik tanpa autentikasi — jadi yang keluar hanya id
    // buram. Tetap stabil antar-request supaya bisa dipakai sebagai key
    // list di frontend, tapi tidak bisa dikembalikan ke nomor aslinya.
    id: crypto.createHash('sha256').update(voter.key).digest('hex').slice(0, 12),
    name: voter.name,
    message: voter.message,
    voteCount: voter.voteCount,
    votedAt: voter.votedAt,
    details: Array.from(voter.details.values()).sort((a, b) => b.voteCount - a.voteCount),
  }));
};

/**
 * Hitung ulang daftar voter sebuah event dari DB.
 * @returns {Promise<object[]>} voter terurut dari aktivitas terbaru
 */
const buildEventVoters = async (eventId, isPaid) => {
  const categories = await prisma.votingCategory.findMany({
    where: { config: { rekomendasiEventId: eventId } },
    select: { id: true, title: true },
  });
  if (categories.length === 0) return [];

  const categoryIds = categories.map((category) => category.id);
  const categoryTitle = new Map(categories.map((category) => [category.id, category.title]));

  const nominees = await prisma.votingNominee.findMany({
    where: { categoryId: { in: categoryIds } },
    select: { id: true, nomineeName: true },
  });
  const nomineeName = new Map(nominees.map((nominee) => [nominee.id, nominee.nomineeName]));

  let voters;

  if (isPaid) {
    // Voting berbayar: satu voter = satu nomor HP pembeli (bisa punya banyak
    // pembelian). Pesan & nama diambil dari pembelian terbaru orang tersebut.
    const [groups, purchases] = await Promise.all([
      prisma.votingVote.groupBy({
        by: ['purchaseId', 'categoryId', 'nomineeId'],
        where: {
          categoryId: { in: categoryIds },
          purchase: { is: { status: 'PAID', buyerPhone: { not: null } } },
        },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      prisma.votingPurchase.findMany({
        where: { rekomendasiEventId: eventId, status: 'PAID', buyerPhone: { not: null } },
        select: { id: true, buyerPhone: true, buyerName: true, supportMessage: true, createdAt: true },
      }),
    ]);

    const purchaseById = new Map(purchases.map((purchase) => [purchase.id, purchase]));

    voters = foldGroups(groups, {
      categoryTitle,
      nomineeName,
      keyOf: (group) => voterKey(purchaseById.get(group.purchaseId)?.buyerPhone),
      enrich: (voter, group) => {
        const purchase = purchaseById.get(group.purchaseId);
        if (!purchase) return;
        // Pembelian terbaru yang menentukan nama & pesan yang ditampilkan.
        if (!voter.latestPurchaseAt || purchase.createdAt > voter.latestPurchaseAt) {
          voter.latestPurchaseAt = purchase.createdAt;
          voter.name = purchase.buyerName || voter.name;
          const message = purchase.supportMessage?.trim();
          if (message) voter.message = message;
        }
      },
    });
  } else {
    // Voting gratis: tidak ada pembelian, jadi tidak ada pesan dukungan —
    // voter dikelompokkan per nama.
    const groups = await prisma.votingVote.groupBy({
      by: ['voterName', 'categoryId', 'nomineeId'],
      where: { categoryId: { in: categoryIds }, voterName: { not: null } },
      _count: { _all: true },
      _max: { createdAt: true },
    });

    voters = foldGroups(groups, {
      categoryTitle,
      nomineeName,
      keyOf: (group) => voterKey(group.voterName),
      enrich: (voter, group) => {
        // Ejaan nama dari vote terbaru yang dipakai untuk ditampilkan.
        const at = group._max?.createdAt || null;
        if (group.voterName && (!voter.nameAt || (at && at > voter.nameAt))) {
          voter.name = group.voterName;
          voter.nameAt = at;
        }
      },
    });
  }

  // Terbaru dulu; voter tanpa timestamp ditaruh paling belakang.
  return voters.sort((a, b) => {
    const aAt = a.votedAt ? a.votedAt.getTime() : 0;
    const bAt = b.votedAt ? b.votedAt.getTime() : 0;
    if (bAt !== aAt) return bAt - aAt;
    return b.voteCount - a.voteCount;
  });
};

/**
 * Daftar LENGKAP voter sebuah event, lewat cache.
 *
 * Sengaja mengembalikan seluruh daftar, bukan yang sudah dipotong: pemanggil
 * seperti /top-voter perlu mengurutkan ulang berdasarkan jumlah vote, dan
 * memotong lebih dulu akan membuat voter terbanyak hilang kalau ia vote lebih
 * awal. Pemotongan untuk ticker dilakukan di route.
 *
 * @returns {Promise<{ voters: object[], total: number, cached: boolean }>}
 */
const getEventVoters = async (eventId, isPaid) => {
  const now = Date.now();
  const cached = votersCache.get(eventId);
  if (cached && cached.expires > now) {
    return { voters: cached.voters, total: cached.voters.length, cached: true };
  }

  const voters = await buildEventVoters(eventId, isPaid);
  votersCache.set(eventId, { expires: now + VOTERS_CACHE_TTL, voters });
  pruneCache();

  return { voters, total: voters.length, cached: false };
};

module.exports = {
  VOTERS_LIMIT,
  VOTERS_CACHE_TTL,
  getEventVoters,
  buildEventVoters,
  invalidateEventVoters,
  invalidateEventVotersSafe,
};
