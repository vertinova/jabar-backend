/**
 * Jenis pengajuan rekomendasi yang TIDAK melewati review Pengcab —
 * langsung ditangani Pengda (PENDING → DISETUJUI/DITOLAK oleh admin).
 *
 * - E-Voting : pengajuan voting yang verifikasinya memang wewenang Pengda.
 * - Kejurcab : event milik Pengcab itu sendiri, jadi tidak perlu direview
 *              ulang oleh Pengcab; cukup persetujuan Pengda.
 */
const DIRECT_PENGDA_EVENT_TYPES = ['E-Voting', 'Kejurcab'];

const normalize = (jenisEvent) => String(jenisEvent || '').trim().toUpperCase();
const DIRECT_PENGDA_NORMALIZED = DIRECT_PENGDA_EVENT_TYPES.map(normalize);

/** true bila pengajuan ini melewati (skip) tahap persetujuan Pengcab. */
function skipsPengcabApproval(jenisEvent) {
  return DIRECT_PENGDA_NORMALIZED.includes(normalize(jenisEvent));
}

/**
 * Potongan filter Prisma untuk daftar/hitungan yang hanya boleh berisi
 * pengajuan yang memang perlu direview Pengcab.
 * Kolasi MySQL case-insensitive, jadi `notIn` juga menangkap variasi kapital.
 */
const pengcabReviewableWhere = {
  OR: [
    { jenisEvent: null },
    { jenisEvent: { notIn: DIRECT_PENGDA_EVENT_TYPES } },
  ],
};

/** Pesan error seragam saat Pengcab mencoba memproses pengajuan jalur Pengda. */
function pengcabSkipMessage(jenisEvent) {
  const label = String(jenisEvent || '').trim() || 'Ini';
  return `Pengajuan ${label} disetujui langsung oleh Pengda, tidak melalui Pengcab`;
}

module.exports = {
  DIRECT_PENGDA_EVENT_TYPES,
  skipsPengcabApproval,
  pengcabReviewableWhere,
  pengcabSkipMessage,
};
