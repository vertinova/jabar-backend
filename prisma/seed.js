const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

// ── FORBASI API config ──
const FORBASI_API_URL = process.env.FORBASI_API_URL || 'https://forbasi.or.id/forbasi/php/api_pengcab_jabar.php';
const FORBASI_API_KEY = process.env.FORBASI_API_KEY || '';

/**
 * Fetch pengcab list from FORBASI API
 */
async function fetchPengcabFromApi() {
  const url = `${FORBASI_API_URL}?action=accounts&role=pengcab&per_page=100&api_key=${encodeURIComponent(FORBASI_API_KEY)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`FORBASI API error: ${response.status}`);
  const result = await response.json();
  if (!result.success) throw new Error(`FORBASI API: ${result.error || 'Unknown error'}`);
  return { total: result.total, data: result.data || [] };
}

/**
 * Map FORBASI API item to local Pengcab model
 */
function mapToPengcab(item) {
  return {
    forbasiId: item.id,
    nama: item.club_name,
    kota: item.city_name || item.region || '',
    email: item.email || null,
    phone: item.phone || null,
    username: item.username || null,
    status: 'AKTIF',
  };
}

async function main() {
  console.log('🌱 Seeding data...\n');

  // ==================== CLEAN ALL DATA ====================
  console.log('🗑️  Cleaning existing data...');
  await prisma.pendaftaranKejurda.deleteMany();
  await prisma.rekomendasiEvent.deleteMany();
  await prisma.kejurda.deleteMany();
  await prisma.user.deleteMany();
  await prisma.pengcab.deleteMany();
  console.log('   Done.\n');

  // ==================== 1. SYNC PENGCAB FROM FORBASI API ====================
  console.log('🔄 Syncing pengcab from FORBASI API...');
  let pengcabs = [];
  try {
    const apiResult = await fetchPengcabFromApi();
    const apiData = apiResult.data;
    console.log(`   Total pengcab dari FORBASI API: ${apiResult.total}`);

    let created = 0;
    let updated = 0;

    for (const item of apiData) {
      const mapped = mapToPengcab(item);
      try {
        const existing = await prisma.pengcab.findUnique({
          where: { forbasiId: mapped.forbasiId }
        });

        if (existing) {
          await prisma.pengcab.update({
            where: { forbasiId: mapped.forbasiId },
            data: {
              nama: mapped.nama,
              kota: mapped.kota,
              email: mapped.email,
              phone: mapped.phone,
              username: mapped.username,
              status: mapped.status,
            }
          });
          updated++;
        } else {
          await prisma.pengcab.create({ data: mapped });
          created++;
        }
      } catch (err) {
        console.warn(`   ⚠️  Skip ${item.club_name}: ${err.message}`);
      }
    }

    console.log(`   ✅ Pengcab synced: ${created} baru, ${updated} diupdate`);
  } catch (err) {
    console.warn(`   ⚠️  Gagal fetch FORBASI API: ${err.message}`);
    console.log('   Melanjutkan tanpa sync pengcab...');
  }

  // Fetch all pengcabs from DB (regardless of whether sync succeeded)
  pengcabs = await prisma.pengcab.findMany({ orderBy: { id: 'asc' } });
  console.log(`   📋 Total pengcab di database: ${pengcabs.length}\n`);

  // Helper: find pengcab by partial kota name
  const findPengcab = (kotaKeyword) => pengcabs.find(p =>
    p.kota?.toLowerCase().includes(kotaKeyword.toLowerCase()) ||
    p.nama?.toLowerCase().includes(kotaKeyword.toLowerCase())
  );

  // ==================== 2. KEJURDA (1 per tahun, dibuat oleh Pengda) ====================
  const kejurda = await prisma.kejurda.create({
    data: {
      namaKejurda: 'Kejurda FORBASI Jawa Barat 2026',
      jenisEvent: 'KEJURDA',
      tanggalMulai: new Date('2026-06-15'),
      tanggalSelesai: new Date('2026-06-18'),
      lokasi: 'GOR Padjajaran, Kota Bandung',
      deskripsi: 'Kejuaraan Daerah Baris-Berbaris Forum Baris Indonesia tingkat Provinsi Jawa Barat tahun 2026. Diikuti oleh seluruh pengurus cabang se-Jawa Barat. Kategori: Baris Wajib, Baris Kreasi, Baris Variasi, dan Colour Guard.',
      statusBuka: true,
      statusApproval: 'DISETUJUI',
    }
  });
  console.log('✅ Kejurda:', kejurda.namaKejurda);

  // ==================== 3. KEJURCAB (1 per tahun per pengcab, diajukan pengcab) ====================
  const pcBandung = findPengcab('bandung');
  const pcBekasi = findPengcab('bekasi');
  const pcBogor = findPengcab('bogor');

  const kejurcabData = [];

  if (pcBandung) {
    kejurcabData.push({
      namaKejurda: `Kejurcab FORBASI ${pcBandung.kota} 2026`,
      jenisEvent: 'KEJURCAB',
      tanggalMulai: new Date('2026-04-20'),
      tanggalSelesai: new Date('2026-04-22'),
      lokasi: 'Lapangan Gasibu, Kota Bandung',
      deskripsi: `Kejuaraan Cabang Baris-Berbaris FORBASI ${pcBandung.kota} tahun 2026. Seleksi atlet terbaik untuk mewakili ${pcBandung.kota} di Kejurda tingkat provinsi.`,
      statusBuka: true,
      statusApproval: 'DISETUJUI',
      pengcabId: pcBandung.id,
    });
  }

  if (pcBekasi) {
    kejurcabData.push({
      namaKejurda: `Kejurcab FORBASI ${pcBekasi.kota} 2026`,
      jenisEvent: 'KEJURCAB',
      tanggalMulai: new Date('2026-05-10'),
      tanggalSelesai: new Date('2026-05-12'),
      lokasi: 'Stadion Patriot Candrabhaga, Kota Bekasi',
      deskripsi: `Kejuaraan Cabang Baris-Berbaris FORBASI ${pcBekasi.kota} tahun 2026. Seleksi atlet untuk perwakilan Bekasi di Kejurda Jawa Barat.`,
      statusBuka: true,
      statusApproval: 'DISETUJUI',
      pengcabId: pcBekasi.id,
    });
  }

  if (pcBogor) {
    kejurcabData.push({
      namaKejurda: `Kejurcab FORBASI ${pcBogor.kota} 2026`,
      jenisEvent: 'KEJURCAB',
      tanggalMulai: new Date('2026-05-25'),
      tanggalSelesai: new Date('2026-05-26'),
      lokasi: 'Lapangan Sempur, Kota Bogor',
      deskripsi: `Kejuaraan Cabang Baris-Berbaris FORBASI ${pcBogor.kota} 2026. Seleksi atlet se-${pcBogor.kota}.`,
      statusBuka: false,
      statusApproval: 'PENDING',
      pengcabId: pcBogor.id,
    });
  }

  for (const kc of kejurcabData) {
    await prisma.kejurda.create({ data: kc });
  }
  console.log(`✅ ${kejurcabData.length} Kejurcab created`);

  // ==================== 4. EVENT REGULER (tidak terbatas) ====================
  const eventRegulerData = [
    {
      namaKejurda: 'Lomba Baris Kreasi HUT RI ke-81',
      jenisEvent: 'EVENT_REGULER',
      tanggalMulai: new Date('2026-08-17'),
      tanggalSelesai: new Date('2026-08-17'),
      lokasi: 'Alun-Alun Kota Bandung',
      deskripsi: 'Lomba baris kreasi dalam rangka memperingati Hari Ulang Tahun Republik Indonesia ke-81. Terbuka untuk umum.',
      statusBuka: true,
      statusApproval: 'DISETUJUI',
    },
    {
      namaKejurda: 'Festival Marching Band & Baris-Berbaris 2026',
      jenisEvent: 'EVENT_REGULER',
      tanggalMulai: new Date('2026-09-20'),
      tanggalSelesai: new Date('2026-09-21'),
      lokasi: 'Lapangan Tegalega, Kota Bandung',
      deskripsi: 'Festival tahunan yang menggabungkan penampilan marching band dan baris-berbaris. Kategori: SD, SMP, SMA/SMK, dan Umum.',
      statusBuka: true,
      statusApproval: 'DISETUJUI',
    },
    {
      namaKejurda: 'Kompetisi Baris-Berbaris Piala Bupati Garut 2026',
      jenisEvent: 'EVENT_REGULER',
      tanggalMulai: new Date('2026-10-05'),
      tanggalSelesai: new Date('2026-10-06'),
      lokasi: 'Alun-Alun Garut',
      deskripsi: 'Kompetisi baris-berbaris memperebutkan Piala Bupati Garut. Terbuka untuk pelajar dan umum se-Jawa Barat.',
      statusBuka: true,
      statusApproval: 'DISETUJUI',
    },
    {
      namaKejurda: 'Open Tournament Baris Variasi Depok 2026',
      jenisEvent: 'EVENT_REGULER',
      tanggalMulai: new Date('2026-07-12'),
      tanggalSelesai: new Date('2026-07-13'),
      lokasi: 'GOR Tri Lomba Juang, Depok',
      deskripsi: 'Turnamen terbuka kategori baris variasi tingkat SMP dan SMA/SMK se-Jabodetabek.',
      statusBuka: true,
      statusApproval: 'DISETUJUI',
    },
    {
      namaKejurda: 'Piala Walikota Cimahi - Lomba Baris-Berbaris 2026',
      jenisEvent: 'EVENT_REGULER',
      tanggalMulai: new Date('2026-11-15'),
      tanggalSelesai: new Date('2026-11-16'),
      lokasi: 'Lapangan Brigif, Kota Cimahi',
      deskripsi: 'Kompetisi baris-berbaris memperebutkan Piala Walikota Cimahi. Kategori Pelajar dan Umum.',
      statusBuka: false,
      statusApproval: 'DISETUJUI',
    },
  ];

  for (const e of eventRegulerData) {
    await prisma.kejurda.create({ data: e });
  }
  console.log(`✅ ${eventRegulerData.length} Event Reguler created`);

  // ==================== SUMMARY ====================
  console.log('\n🎉 Seed complete!\n');
  console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
  console.log('║  Data pengcab & user TIDAK dibuat dummy — login via FORBASI API          ║');
  console.log('║  Gunakan akun FORBASI yang sudah terdaftar untuk login                   ║');
  console.log('║                                                                           ║');
  console.log('║  Contoh login:                                                            ║');
  console.log('║  • admin_pengda_jawa_barat (password FORBASI) → SUPER ADMIN               ║');
  console.log('║  • admin_pengcab_kota_bandung (password FORBASI) → PENGCAB                 ║');
  console.log('║  • Akun member FORBASI lainnya → USER                                     ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════╝');
  console.log('\n📊 Data Summary:');
  console.log(`   🏢 ${pengcabs.length} Pengcab (synced dari FORBASI API)`);
  console.log(`   👤 User dibuat otomatis saat login via FORBASI`);
  console.log(`   🏆 1 Kejurda | ${kejurcabData.length} Kejurcab | ${eventRegulerData.length} Event Reguler`);
  console.log('');
}

main()
  .catch(e => { console.error('❌ Seed error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
