/**
 * Jadwal buka/tutup sebuah kategori voting, disalin dari Simpaskor
 * (backend/src/lib/jadwalKategoriVoting.ts).
 *
 * Bawaannya kategori mengikuti jadwal arena (EventVotingConfig). Panitia bisa
 * memberi kategori jadwal sendiri — mis. kategori SD ditutup lebih dulu, SMP
 * menyusul, atau satu kategori diperpanjang melewati arena. Jadwal sendiri
 * BERLAKU APA ADANYA; sisi yang dikosongkan mengikuti arena. Dulu jadwal itu
 * dijepit di dalam arena, sehingga kategori yang diperpanjang tetap tutup
 * bersama arena dan arena tidak cocok dengan jadwal yang disimpan panitia.
 *
 * Kembarannya di frontend: src/lib/jadwalKategoriVoting.js — aturannya harus sama.
 */

const milikSendiri = (kategori) => Boolean(kategori && kategori.ikutiJadwalArena === false);

/** Rentang yang benar-benar berlaku bagi kategori ini. */
const jadwalEfektifKategori = (kategori, arena) => {
  if (!milikSendiri(kategori)) {
    return { startDate: arena?.startDate || null, endDate: arena?.endDate || null };
  }
  return {
    startDate: kategori.startDate || arena?.startDate || null,
    endDate: kategori.endDate || arena?.endDate || null,
  };
};

/* Alasan vote ke kategori ini ditolak saat ini, atau null bila sedang buka.
   Nama kategori disebut bila penyebabnya jadwal kategori itu sendiri, supaya
   pemilih tahu arenanya masih buka untuk kategori lain. */
const alasanJadwalKategoriDitolak = (kategori, arena, sekarang = new Date()) => {
  const { startDate, endDate } = jadwalEfektifKategori(kategori, arena);
  const sendiri = milikSendiri(kategori);
  if (startDate && sekarang < new Date(startDate)) {
    return sendiri && kategori.startDate
      ? `Voting kategori ${kategori.title} belum dimulai`
      : 'Voting belum dimulai';
  }
  if (endDate && sekarang > new Date(endDate)) {
    return sendiri && kategori.endDate
      ? `Voting kategori ${kategori.title} sudah ditutup`
      : 'Voting sudah ditutup';
  }
  return null;
};

/* Periode voting keseluruhan sebuah arena: dari pembukaan paling awal sampai
   penutupan paling akhir di antara arena dan kategori aktif berjadwal sendiri.
   Dipakai untuk status event (buka/segera/selesai) di daftar publik. Batas yang
   kosong berarti tanpa batas, jadi menang atas tanggal mana pun. */
const periodeVotingArena = (arena, kategoriList = []) => {
  const jadwal = [
    { startDate: arena?.startDate || null, endDate: arena?.endDate || null },
    ...kategoriList
      .filter((k) => k && k.isActive !== false && milikSendiri(k))
      .map((k) => jadwalEfektifKategori(k, arena)),
  ];
  const waktu = (nilai) => new Date(nilai).getTime();
  const startDate = jadwal.some((j) => !j.startDate)
    ? null
    : jadwal.reduce((a, j) => (waktu(j.startDate) < waktu(a) ? j.startDate : a), jadwal[0].startDate);
  const endDate = jadwal.some((j) => !j.endDate)
    ? null
    : jadwal.reduce((a, j) => (waktu(j.endDate) > waktu(a) ? j.endDate : a), jadwal[0].endDate);
  return { startDate, endDate };
};

module.exports = { jadwalEfektifKategori, alasanJadwalKategoriDitolak, periodeVotingArena };
