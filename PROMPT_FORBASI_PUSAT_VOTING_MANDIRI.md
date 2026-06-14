# Prompt AI Agent FORBASI Pusat

Terapkan penyesuaian fitur E-Voting di aplikasi FORBASI Pusat berdasarkan kontrak
API Pengda Jabar berikut.

## Tujuan

Ubah konsep UI dan alur approval dari "voting harus berasal dari pengajuan event"
menjadi "kampanye vote mandiri". Penyelenggara Pengda Jabar sekarang dapat membuat
vote langsung tanpa mengajukan rekomendasi event, proposal, atau approval event
terlebih dahulu. FORBASI Pusat tetap bertugas menyetujui vote dan menetapkan bagi
hasil.

## API yang Dipakai

- `GET /api/external/voting/events`
- `PATCH /api/external/voting/events/:eventId/approval`
- Header: `X-API-Key: <key>` dengan permission `voting:read` dan `voting:write`

Nama endpoint dan parameter `eventId` dipertahankan untuk backward compatibility.
Pada fitur ini, anggap data tersebut sebagai kampanye vote:

- `id`: ID kampanye/wadah vote
- `namaEvent`: judul vote
- `jenisEvent`: `E-Voting`
- `deskripsi`: deskripsi vote
- `lokasi`: lokasi atau keterangan opsional
- `tanggalMulai` dan `tanggalSelesai`: periode vote
- `user`: akun penyelenggara
- `votingConfig`: konfigurasi, approval, bagi hasil, kategori, dan nominee

## Perubahan UI

1. Ubah judul/menu dari "Pengajuan Event E-Voting" menjadi "Pengajuan Vote".
2. Jangan mensyaratkan atau menampilkan status rekomendasi event sebagai prasyarat.
3. Tampilkan judul vote, penyelenggara, periode, harga per vote, mode berbayar,
   jumlah kategori, nominee, dan total vote.
4. Sediakan filter approval `PENDING`, `APPROVED`, dan `REJECTED`.
5. Pada detail, tampilkan kategori dan nominee dari `votingConfig.categories`.
6. Form approval wajib meminta:
   - `approvalStatus`
   - `organizerSharePercent`
   - `pengdaSharePercent`
   - `approvalNote`
7. Saat `APPROVED`, validasi kedua persentase berada pada rentang 0-100 dan totalnya
   tepat 100%.
8. Saat `PENDING` atau `REJECTED`, jelaskan bahwa voting otomatis dinonaktifkan.
9. Setelah mutasi berhasil, refresh daftar dan tampilkan pesan dari API.

## Payload Approval

```json
{
  "approvalStatus": "APPROVED",
  "organizerSharePercent": 70,
  "pengdaSharePercent": 30,
  "approvalNote": "Disetujui untuk periode voting berjalan"
}
```

## Acceptance Criteria

- Vote baru berstatus `PENDING` muncul tanpa harus ada pengajuan rekomendasi event.
- Agent/UI tidak memblokir approval berdasarkan status event.
- Approval dan rejection memakai endpoint existing di atas.
- Voting hanya dapat diaktifkan penyelenggara setelah status `APPROVED`.
- Tampilan lama tetap dapat membaca data voting yang sudah ada.
- Tidak mengubah modul rekomendasi event, Kejurda, atau approval Pengcab.

Gunakan pola komponen, API client, toast, modal, dan state management yang sudah
ada di repository FORBASI Pusat. Batasi perubahan hanya pada modul E-Voting dan
tambahkan test atau verifikasi build/lint yang relevan.
