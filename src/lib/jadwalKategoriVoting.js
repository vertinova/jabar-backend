/**
 * Jadwal buka/tutup sebuah kategori voting, disalin dari Simpaskor
 * (backend/src/lib/jadwalKategoriVoting.ts).
 *
 * Bawaannya kategori mengikuti jadwal arena (EventVotingConfig). Panitia bisa
 * memberi kategori jadwal sendiri — mis. kategori SD ditutup lebih dulu, SMP
 * menyusul — tetapi jadwal itu selalu DI DALAM jadwal arena: dibuka paling
 * cepat saat arena dibuka, ditutup paling lambat saat arena ditutup.
 *
 * Kembarannya di frontend: src/lib/jadwalKategoriVoting.js — aturannya harus sama.
 */

const yangLebihLambat = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
const yangLebihAwal = (a, b) => (!a ? b : !b ? a : a < b ? a : b);

/** Rentang yang benar-benar berlaku bagi kategori ini. */
const jadwalEfektifKategori = (kategori, arena) => {
  if (!kategori || kategori.ikutiJadwalArena !== false) {
    return { startDate: arena?.startDate || null, endDate: arena?.endDate || null };
  }
  return {
    startDate: yangLebihLambat(arena?.startDate || null, kategori.startDate || null),
    endDate: yangLebihAwal(arena?.endDate || null, kategori.endDate || null),
  };
};

/* Alasan vote ke kategori ini ditolak saat ini, atau null bila sedang buka.
   Nama kategori disebut bila penyebabnya jadwal kategori itu sendiri, supaya
   pemilih tahu arenanya masih buka untuk kategori lain. */
const alasanJadwalKategoriDitolak = (kategori, arena, sekarang = new Date()) => {
  const { startDate, endDate } = jadwalEfektifKategori(kategori, arena);
  const milikKategori = kategori?.ikutiJadwalArena === false;
  if (startDate && sekarang < startDate) {
    return milikKategori && startDate !== arena?.startDate
      ? `Voting kategori ${kategori.title} belum dimulai`
      : 'Voting belum dimulai';
  }
  if (endDate && sekarang > endDate) {
    return milikKategori && endDate !== arena?.endDate
      ? `Voting kategori ${kategori.title} sudah ditutup`
      : 'Voting sudah ditutup';
  }
  return null;
};

module.exports = { jadwalEfektifKategori, alasanJadwalKategoriDitolak };
