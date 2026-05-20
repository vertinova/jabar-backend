const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const demoEventNames = [
  'DEMO - Voting Publik FORBASI Jabar',
  'DEMO - Ranking Prestasi FORBASI Jabar',
  'DEMO - Kejuaraan Rekomendasi Bandung',
];

async function ensureOrganizer() {
  const password = await bcrypt.hash('password123', 10);
  return prisma.user.upsert({
    where: { email: 'demo.penyelenggara@forbasi.test' },
    update: {
      name: 'Demo Penyelenggara',
      password,
      role: 'PENYELENGGARA',
      phone: '081234567890',
    },
    create: {
      name: 'Demo Penyelenggara',
      email: 'demo.penyelenggara@forbasi.test',
      password,
      role: 'PENYELENGGARA',
      phone: '081234567890',
    },
  });
}

async function cleanupDemoEvents() {
  const events = await prisma.rekomendasiEvent.findMany({
    where: { namaEvent: { in: demoEventNames } },
    select: { id: true },
  });
  if (!events.length) return;

  await prisma.rekomendasiEvent.deleteMany({
    where: { id: { in: events.map((event) => event.id) } },
  });
}

async function createVote(tx, categoryId, nomineeId, voterName, voterEmail) {
  await tx.votingVote.create({
    data: {
      categoryId,
      nomineeId,
      voterName,
      voterEmail,
      voterIp: '127.0.0.1',
    },
  });
  await tx.votingNominee.update({
    where: { id: nomineeId },
    data: { voteCount: { increment: 1 } },
  });
}

async function seedVotingEvent(organizer, pengcabId) {
  const event = await prisma.rekomendasiEvent.create({
    data: {
      namaEvent: demoEventNames[0],
      jenisEvent: 'LKBB',
      tanggalMulai: new Date('2026-06-15T02:00:00.000Z'),
      tanggalSelesai: new Date('2026-06-15T10:00:00.000Z'),
      lokasi: 'GOR Pajajaran Bandung',
      deskripsi: 'Data dummy untuk menguji fitur e-voting berbayar Midtrans.',
      penyelenggara: 'Demo Organizer FORBASI',
      kontakPerson: '081234567890',
      status: 'DISETUJUI',
      nomorSurat: 'DEMO/EVOTING/FORBASI-JABAR/2026',
      suratRekomendasi: '/uploads/demo-surat-rekomendasi.pdf',
      approvedPengcabAt: new Date(),
      approvedPengdaAt: new Date(),
      userId: organizer.id,
      pengcabId,
    },
  });

  const config = await prisma.eventVotingConfig.create({
    data: {
      rekomendasiEventId: event.id,
      enabled: true,
      isPaid: true,
      pricePerVote: 2500,
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-12-31T23:59:59.000Z'),
    },
  });

  const favorite = await prisma.votingCategory.create({
    data: {
      configId: config.id,
      title: 'Tim Terfavorit',
      description: 'Kategori dummy untuk voting berbayar Midtrans.',
      mode: 'TEAM',
      maxVotesPerVoter: 3,
      order: 1,
    },
  });

  const danton = await prisma.votingCategory.create({
    data: {
      configId: config.id,
      title: 'Danton Terbaik',
      description: 'Kategori dummy untuk nominee individu.',
      mode: 'PERSONAL',
      position: 'Danton',
      maxVotesPerVoter: 1,
      order: 2,
    },
  });

  const nominees = await Promise.all([
    prisma.votingNominee.create({ data: { categoryId: favorite.id, nomineeName: 'Rajawali Muda', nomineeSubtitle: 'Kota Bandung' } }),
    prisma.votingNominee.create({ data: { categoryId: favorite.id, nomineeName: 'Garuda Patriot', nomineeSubtitle: 'Kabupaten Bogor' } }),
    prisma.votingNominee.create({ data: { categoryId: favorite.id, nomineeName: 'Siliwangi Guard', nomineeSubtitle: 'Kota Depok' } }),
    prisma.votingNominee.create({ data: { categoryId: danton.id, nomineeName: 'Nadia Putri', nomineeSubtitle: 'Rajawali Muda' } }),
    prisma.votingNominee.create({ data: { categoryId: danton.id, nomineeName: 'Raka Pratama', nomineeSubtitle: 'Garuda Patriot' } }),
  ]);

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < 16; i += 1) await createVote(tx, favorite.id, nominees[0].id, `Demo Voter ${i + 1}`, `voter${i + 1}@demo.test`);
    for (let i = 0; i < 10; i += 1) await createVote(tx, favorite.id, nominees[1].id, `Demo Voter B${i + 1}`, `voterb${i + 1}@demo.test`);
    for (let i = 0; i < 6; i += 1) await createVote(tx, favorite.id, nominees[2].id, `Demo Voter C${i + 1}`, `voterc${i + 1}@demo.test`);
    for (let i = 0; i < 9; i += 1) await createVote(tx, danton.id, nominees[3].id, `Demo Danton ${i + 1}`, `danton${i + 1}@demo.test`);
    for (let i = 0; i < 5; i += 1) await createVote(tx, danton.id, nominees[4].id, `Demo Danton B${i + 1}`, `dantonb${i + 1}@demo.test`);
  });

  return event;
}

async function seedRankingEvents(organizer, pengcabId) {
  const rankingEvent = await prisma.rekomendasiEvent.create({
    data: {
      namaEvent: demoEventNames[1],
      jenisEvent: 'LKBB',
      tanggalMulai: new Date('2026-05-10T02:00:00.000Z'),
      tanggalSelesai: new Date('2026-05-10T10:00:00.000Z'),
      lokasi: 'Bandung Creative Hub',
      deskripsi: 'Data dummy untuk menguji input hasil juara dan ranking prestasi.',
      penyelenggara: 'Demo Organizer FORBASI',
      kontakPerson: '081234567890',
      status: 'DISETUJUI',
      nomorSurat: 'DEMO/RANKING/FORBASI-JABAR/2026',
      suratRekomendasi: '/uploads/demo-surat-rekomendasi.pdf',
      approvedPengcabAt: new Date(),
      approvedPengdaAt: new Date(),
      userId: organizer.id,
      pengcabId,
    },
  });

  const secondEvent = await prisma.rekomendasiEvent.create({
    data: {
      namaEvent: demoEventNames[2],
      jenisEvent: 'LKBB',
      tanggalMulai: new Date('2026-04-20T02:00:00.000Z'),
      tanggalSelesai: new Date('2026-04-20T10:00:00.000Z'),
      lokasi: 'Alun-alun Bandung',
      deskripsi: 'Event dummy kedua agar ranking agregat terlihat.',
      penyelenggara: 'Demo Organizer FORBASI',
      kontakPerson: '081234567890',
      status: 'DISETUJUI',
      nomorSurat: 'DEMO/BANDUNG/FORBASI-JABAR/2026',
      suratRekomendasi: '/uploads/demo-surat-rekomendasi.pdf',
      approvedPengcabAt: new Date(),
      approvedPengdaAt: new Date(),
      userId: organizer.id,
      pengcabId,
    },
  });

  const rows = [
    [rankingEvent.id, 'Rajawali Muda', 'Kota Bandung', 'LKBB Madya', 1, 100],
    [rankingEvent.id, 'Garuda Patriot', 'Kabupaten Bogor', 'LKBB Madya', 2, 70],
    [rankingEvent.id, 'Siliwangi Guard', 'Kota Depok', 'LKBB Madya', 3, 50],
    [rankingEvent.id, 'Rajawali Muda', 'Kota Bandung', 'Danton Terbaik', 2, 70],
    [rankingEvent.id, 'Cirebon Command', 'Kota Cirebon', 'Variasi Formasi', 1, 100],
    [secondEvent.id, 'Garuda Patriot', 'Kabupaten Bogor', 'LKBB Utama', 1, 100],
    [secondEvent.id, 'Rajawali Muda', 'Kota Bandung', 'LKBB Utama', 3, 50],
    [secondEvent.id, 'Siliwangi Guard', 'Kota Depok', 'PBB Murni', 1, 100],
    [secondEvent.id, 'Cirebon Command', 'Kota Cirebon', 'PBB Murni', 2, 70],
  ];

  await prisma.rankingResult.createMany({
    data: rows.map(([eventId, participantName, origin, category, rank, points]) => ({
      rekomendasiEventId: eventId,
      participantName,
      participantKey: participantName.toLowerCase(),
      participantType: 'TEAM',
      origin,
      category,
      rank,
      title: rank === 1 ? 'Juara 1' : rank === 2 ? 'Juara 2' : rank === 3 ? 'Juara 3' : `Peringkat ${rank}`,
      points,
      createdById: organizer.id,
    })),
  });

  return [rankingEvent, secondEvent];
}

async function main() {
  const organizer = await ensureOrganizer();
  const pengcab = await prisma.pengcab.findFirst({ orderBy: { id: 'asc' }, select: { id: true } });

  await cleanupDemoEvents();
  const votingEvent = await seedVotingEvent(organizer, pengcab?.id || null);
  const rankingEvents = await seedRankingEvents(organizer, pengcab?.id || null);

  const [standings, votingEvents] = await Promise.all([
    prisma.rankingResult.count(),
    prisma.rekomendasiEvent.count({ where: { votingConfig: { is: { enabled: true } } } }),
  ]);

  console.log(JSON.stringify({
    success: true,
    organizer: { id: organizer.id, name: organizer.name, email: organizer.email },
    votingEvent: { id: votingEvent.id, name: votingEvent.namaEvent },
    rankingEvents: rankingEvents.map((event) => ({ id: event.id, name: event.namaEvent })),
    totalRankingResults: standings,
    totalVotingEvents: votingEvents,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
