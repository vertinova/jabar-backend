# FORBASI Jabar - External API Documentation

> Dokumentasi API untuk integrasi **FORBASI Pusat** dengan sistem **FORBASI Jabar**.
>
> Base URL: `https://<domain>/api/external`

---

## Autentikasi

Semua endpoint (kecuali **Public Routes**) membutuhkan header:

```
X-API-Key: <your-api-key>
```

**Rate Limit:** 100 request/menit per API key.

### Cek Info API Key

```
GET /api/external/api-key/info
```

**Response:**
```json
{
  "id": 1,
  "name": "FORBASI Pusat",
  "permissions": ["rekomendasi:read", "rekomendasi:write", "rekomendasi:delete", ...]
}
```

### Permissions yang Tersedia

| Permission | Akses |
|---|---|
| `rekomendasi:read` | Lihat semua rekomendasi event |
| `rekomendasi:write` | Buat, edit, ubah status rekomendasi |
| `rekomendasi:delete` | Hapus rekomendasi |
| `kejurda:read` | Lihat semua kejurda/event |
| `kejurda:write` | Buat, edit, approve/reject kejurda |
| `kejurda:delete` | Hapus kejurda |
| `pendaftaran:read` | Lihat pendaftaran peserta |
| `pendaftaran:write` | Update status pendaftaran |
| `pendaftaran:delete` | Hapus pendaftaran |
| `pengcab:read` | Lihat data pengcab |
| `pengcab:write` | Kelola pengcab |
| `pengcab:delete` | Hapus pengcab |
| `users:read` | Lihat data user/anggota |
| `users:write` | Update data user |
| `dashboard:read` | Lihat statistik & dashboard |
| `dashboard:write` | Refresh cache dashboard |
| `landing:read` | Lihat data landing page |
| `landing:write` | Kelola landing page |
| `landing:delete` | Hapus item landing |
| `dokumen:read` | Lihat format dokumen |
| `dokumen:write` | Upload format dokumen |
| `dokumen:delete` | Hapus format dokumen |
| `config:read` | Lihat site config |
| `config:write` | Update site config |

### Error Responses

| Status | Keterangan |
|---|---|
| `401` | API key tidak ditemukan atau tidak valid |
| `403` | API key nonaktif atau permission tidak cukup |
| `429` | Rate limit exceeded (>100 req/menit) |

---

## Public Routes (Tanpa API Key)

### Get Landing Data Regional

```
GET /api/external/landing/public/:region
```

**Contoh:** `GET /api/external/landing/public/jabar`

**Response:**
```json
{
  "region": "jabar",
  "heroSlides": [...],
  "berita": [...],
  "struktur": [...],
  "config": { "key": "value", ... },
  "kejurdaOpen": [...],
  "rekomendasi": [...],
  "pengcab": [...],
  "stats": {
    "pengcab": 12,
    "rekomendasi": 45,
    "kejurda": 8,
    "users": 320
  }
}
```

---

## REKOMENDASI EVENT

Mengelola pengajuan rekomendasi event dari penyelenggara dan kejurcab.

### Alur Status Rekomendasi

```
DRAFT → PENDING → APPROVED_PENGCAB → DISETUJUI
                                   ↘ DITOLAK
                ↘ DITOLAK
```

| Status | Keterangan |
|---|---|
| `DRAFT` | Masih draft, belum diajukan |
| `PENDING` | Sudah diajukan, menunggu review pengcab |
| `APPROVED_PENGCAB` | Disetujui pengcab, menunggu approval admin/pengda |
| `DISETUJUI` | Disetujui final, surat rekomendasi & nomor surat otomatis digenerate |
| `DITOLAK` | Ditolak (wajib ada alasan penolakan) |

### 1. Get Semua Rekomendasi

```
GET /api/external/rekomendasi
```

**Permission:** `rekomendasi:read`

**Query Parameters:**

| Param | Tipe | Keterangan |
|---|---|---|
| `search` | string | Cari berdasarkan nama event, penyelenggara, atau lokasi |
| `status` | string | Filter status: `DRAFT`, `PENDING`, `APPROVED_PENGCAB`, `DISETUJUI`, `DITOLAK` |

**Response:**
```json
[
  {
    "id": 1,
    "namaEvent": "Kejurcab Karate 2026",
    "jenisEvent": "Lomba",
    "tanggalMulai": "2026-04-15T00:00:00.000Z",
    "tanggalSelesai": "2026-04-17T00:00:00.000Z",
    "lokasi": "GOR Bandung",
    "deskripsi": "Kejuaraan cabang karate...",
    "penyelenggara": "FORKI Kota Bandung",
    "kontakPerson": "08123456789",
    "noBilingSimpaskor": "SIMP-001",
    "dokumenSurat": "/uploads/1234567890-doc.pdf",
    "poster": "/uploads/1234567890-poster.jpg",
    "persyaratan": { ... },
    "mataLomba": [ ... ],
    "proposal": "/uploads/1234567890-proposal.pdf",
    "status": "PENDING",
    "catatanPengcab": null,
    "catatanAdmin": null,
    "approvedPengcabAt": null,
    "approvedPengdaAt": null,
    "nomorSurat": null,
    "suratRekomendasi": null,
    "userId": 5,
    "pengcabId": 3,
    "createdAt": "2026-03-15T10:00:00.000Z",
    "updatedAt": "2026-03-15T10:00:00.000Z",
    "user": {
      "id": 5,
      "name": "Ahmad Fauzi",
      "email": "ahmad@mail.com"
    },
    "pengcab": {
      "id": 3,
      "nama": "FORBASI Kota Bandung",
      "kota": "Bandung"
    }
  }
]
```

### 2. Get Detail Rekomendasi

```
GET /api/external/rekomendasi/:id
```

**Permission:** `rekomendasi:read`

**Response:** Objek rekomendasi lengkap (sama seperti di atas + field `phone` pada user).

### 3. Buat Rekomendasi Baru

```
POST /api/external/rekomendasi
```

**Permission:** `rekomendasi:write`

**Content-Type:** `multipart/form-data`

**Form Fields:**

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `namaEvent` | string | Ya (jika bukan draft) | Nama event |
| `jenisEvent` | string | Tidak | Jenis: Lomba, Festival, Pelatihan, Seminar, Lainnya |
| `tanggalMulai` | string (ISO date) | Tidak | Tanggal mulai event |
| `tanggalSelesai` | string (ISO date) | Tidak | Tanggal selesai event |
| `lokasi` | string | Tidak | Lokasi penyelenggaraan |
| `deskripsi` | string | Tidak | Deskripsi event |
| `penyelenggara` | string | Tidak | Nama penyelenggara |
| `kontakPerson` | string | Tidak | Nomor kontak |
| `noBilingSimpaskor` | string | Tidak | Nomor billing SIMPASKOR |
| `pengcabId` | integer | Tidak | ID pengcab terkait |
| `submitAction` | string | Tidak | `"draft"` untuk simpan draft, kosong/lainnya = langsung PENDING |
| `mataLomba` | JSON string | Tidak | Array mata lomba (JSON stringified) |
| `persyaratan` | JSON string | Tidak | Objek persyaratan (JSON stringified) |
| `proposalKegiatan` | file | Tidak | File proposal (PDF/DOC/DOCX, maks 5MB) |
| `dokumenSurat` | file | Tidak | Dokumen surat (PDF/Gambar, maks 5MB) |
| `poster` | file | Tidak | Poster event (Gambar, maks 5MB) |

**File persyaratan** (upload sebagai field terpisah):
- `suratIzinSekolah`, `suratIzinKepolisian`, `suratRekomendasiDinas`
- `suratIzinVenue`, `suratRekomendasiPPI`
- `fotoLapangan`, `fotoTempatIbadah`, `fotoBarak`, `fotoAreaParkir`
- `fotoRuangKesehatan`, `fotoMCK`, `fotoTempatSampah`, `fotoRuangKomisi`
- `faktaIntegritasKomisi`, `faktaIntegritasHonor`, `faktaIntegritasPanitia`
- `desainSertifikat`
- `juriFoto_0`, `juriFoto_1`, ... (foto juri berdasarkan index)

**Response (201):**
```json
{
  "message": "Permohonan rekomendasi berhasil diajukan",
  "event": { ... }
}
```

### 4. Update Rekomendasi

```
PUT /api/external/rekomendasi/:id
```

**Permission:** `rekomendasi:write`

**Content-Type:** `multipart/form-data`

> Hanya bisa update rekomendasi berstatus `DRAFT` atau `DITOLAK`.

**Form Fields:** Sama dengan POST. Field yang tidak dikirim akan tetap menggunakan data lama.

**Response:**
```json
{
  "message": "Permohonan berhasil diajukan ulang",
  "event": { ... }
}
```

### 5. Update Status Rekomendasi (Approve/Reject)

```
PATCH /api/external/rekomendasi/:id/status
```

**Permission:** `rekomendasi:write`

**Content-Type:** `application/json`

**Body:**

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `status` | string | Ya | Status baru: `APPROVED_PENGCAB`, `DISETUJUI`, `DITOLAK` |
| `catatanAdmin` | string | Ya (jika DITOLAK) | Alasan penolakan |
| `catatanPengcab` | string | Tidak | Catatan pengcab |

**Contoh - Approve level Pengcab:**
```json
{
  "status": "APPROVED_PENGCAB",
  "catatanPengcab": "Lengkap, disetujui pengcab"
}
```

**Contoh - Approve final (Pengda):**
```json
{
  "status": "DISETUJUI",
  "catatanAdmin": "Disetujui untuk dilaksanakan"
}
```

> Saat status diubah ke `DISETUJUI`:
> - Nomor surat otomatis digenerate (format: `UM.001/FORBASI-JABAR/II/2026`)
> - Surat rekomendasi PDF otomatis digenerate

**Contoh - Tolak:**
```json
{
  "status": "DITOLAK",
  "catatanAdmin": "Dokumen persyaratan belum lengkap"
}
```

**Response:**
```json
{
  "message": "Status rekomendasi diubah menjadi DISETUJUI",
  "event": { ... }
}
```

### 6. Hapus Rekomendasi

```
DELETE /api/external/rekomendasi/:id
```

**Permission:** `rekomendasi:delete`

**Response:**
```json
{
  "message": "Data rekomendasi berhasil dihapus"
}
```

---

## KEJURDA / EVENT (Kejuaraan Daerah & Kejurcab)

### 1. Get Semua Kejurda

```
GET /api/external/kejurda
```

**Permission:** `kejurda:read`

### 2. Get Kejurda yang Buka Pendaftaran

```
GET /api/external/kejurda/open
```

**Permission:** `kejurda:read`

### 3. Get Detail Kejurda

```
GET /api/external/kejurda/:id
```

**Permission:** `kejurda:read`

### 4. Buat Kejurda

```
POST /api/external/kejurda
```

**Permission:** `kejurda:write`  
**Content-Type:** `multipart/form-data`  
**File field:** `poster` (gambar, maks 5MB)

### 5. Update Kejurda

```
PUT /api/external/kejurda/:id
```

**Permission:** `kejurda:write`

### 6. Hapus Kejurda

```
DELETE /api/external/kejurda/:id
```

**Permission:** `kejurda:delete`

### 7. Approve Kejurda

```
PATCH /api/external/kejurda/:id/approve
```

**Permission:** `kejurda:write`

### 8. Reject Kejurda

```
PATCH /api/external/kejurda/:id/reject
```

**Permission:** `kejurda:write`

### 9. Toggle Early Bird

```
PATCH /api/external/kejurda/:id/toggle-early-bird
```

**Permission:** `kejurda:write`

### 10. Toggle Pendaftaran

```
PATCH /api/external/kejurda/:id/toggle-registration
```

**Permission:** `kejurda:write`

### 11. Generate Surat Kejurcab

```
POST /api/external/kejurda/:id/generate-surat
```

**Permission:** `kejurda:write`

---

## PENDAFTARAN PESERTA

### 1. Get Semua Pendaftaran

```
GET /api/external/pendaftaran
```

**Permission:** `pendaftaran:read`

### 2. Get Detail Pendaftaran

```
GET /api/external/pendaftaran/:id
```

**Permission:** `pendaftaran:read`

### 3. Buat Pendaftaran

```
POST /api/external/pendaftaran
```

**Permission:** `pendaftaran:write`  
**Content-Type:** `multipart/form-data`  
**File fields:** `buktiPembayaran`, `buktiDP`, `dokumen` (masing-masing maks 5MB)

### 4. Update Status Pendaftaran

```
PATCH /api/external/pendaftaran/:id/status
```

**Permission:** `pendaftaran:write`

### 5. Upload Pelunasan

```
PATCH /api/external/pendaftaran/:id/pelunasan
```

**Permission:** `pendaftaran:write`  
**File field:** `buktiPelunasan` (maks 5MB)

### 6. Verify Pelunasan

```
PATCH /api/external/pendaftaran/:id/verify-pelunasan
```

**Permission:** `pendaftaran:write`

### 7. Reject Pelunasan

```
PATCH /api/external/pendaftaran/:id/reject-pelunasan
```

**Permission:** `pendaftaran:write`

### 8. Hapus Pendaftaran

```
DELETE /api/external/pendaftaran/:id
```

**Permission:** `pendaftaran:delete`

---

## PENGCAB (Pengurus Cabang)

### 1. Get Semua Pengcab

```
GET /api/external/pengcab
```

**Permission:** `pengcab:read`

### 2. Get Detail Pengcab

```
GET /api/external/pengcab/:id
```

**Permission:** `pengcab:read`

### 3. Buat Pengcab

```
POST /api/external/pengcab
```

**Permission:** `pengcab:write`

### 4. Sync dari Forbasi

```
POST /api/external/pengcab/sync-forbasi
```

**Permission:** `pengcab:write`

### 5. Update Pengcab

```
PUT /api/external/pengcab/:id
```

**Permission:** `pengcab:write`

### 6. Hapus Pengcab

```
DELETE /api/external/pengcab/:id
```

**Permission:** `pengcab:delete`

---

## USERS / ANGGOTA

### 1. Get Semua Users

```
GET /api/external/users
```

**Permission:** `users:read`

### 2. Get Statistik User

```
GET /api/external/users/stats
```

**Permission:** `users:read`

### 3. Get Anggota KTA

```
GET /api/external/users/anggota-kta
```

**Permission:** `users:read`

### 4. Get Detail User

```
GET /api/external/users/:id
```

**Permission:** `users:read`

### 5. Update User

```
PUT /api/external/users/:id
```

**Permission:** `users:write`

---

## DASHBOARD & STATISTIK

### 1. Get Statistik

```
GET /api/external/dashboard/stats
```

**Permission:** `dashboard:read`

### 2. Get Data Landing

```
GET /api/external/dashboard/landing
```

**Permission:** `dashboard:read`

### 3. Get Data Anggota Forbasi

```
GET /api/external/dashboard/anggota
```

**Permission:** `dashboard:read`

### 4. Refresh Cache Anggota

```
POST /api/external/dashboard/anggota/refresh
```

**Permission:** `dashboard:write`

---

## KATEGORI EVENT

### 1. Get Semua Kategori

```
GET /api/external/kategori-event
```

**Permission:** `kejurda:read`

### 2. Buat Kategori

```
POST /api/external/kategori-event
```

**Permission:** `kejurda:write`

### 3. Update Kategori

```
PUT /api/external/kategori-event/:id
```

**Permission:** `kejurda:write`

### 4. Hapus Kategori

```
DELETE /api/external/kategori-event/:id
```

**Permission:** `kejurda:delete`

---

## FORMAT DOKUMEN

### 1. Get Semua Format Dokumen

```
GET /api/external/format-dokumen
```

**Permission:** `dokumen:read`

### 2. Upload Format Dokumen

```
POST /api/external/format-dokumen
```

**Permission:** `dokumen:write`  
**File field:** `file` (maks 5MB)

### 3. Update Format Dokumen

```
PUT /api/external/format-dokumen/:id
```

**Permission:** `dokumen:write`

### 4. Hapus Format Dokumen

```
DELETE /api/external/format-dokumen/:id
```

**Permission:** `dokumen:delete`

---

## SITE CONFIG

### 1. Get Semua Config

```
GET /api/external/site-config
```

**Permission:** `config:read`

### 2. Get Config Surat

```
GET /api/external/site-config/surat-config
```

**Permission:** `config:read`

### 3. Get Config by Key

```
GET /api/external/site-config/:key
```

**Permission:** `config:read`

### 4. Simpan Tanda Tangan

```
POST /api/external/site-config/signature
```

**Permission:** `config:write`

### 5. Upload Stempel

```
POST /api/external/site-config/stamp
```

**Permission:** `config:write`  
**File field:** `stamp`

---

## LANDING PAGE

### Hero Slides

| Method | Endpoint | Permission |
|---|---|---|
| GET | `/api/external/landing/hero-slides` | `landing:read` |
| POST | `/api/external/landing/hero-slides` | `landing:write` |
| PUT | `/api/external/landing/hero-slides/:id` | `landing:write` |
| DELETE | `/api/external/landing/hero-slides/:id` | `landing:delete` |

### Berita

| Method | Endpoint | Permission |
|---|---|---|
| GET | `/api/external/landing/berita` | `landing:read` |
| GET | `/api/external/landing/berita/:id` | `landing:read` |
| POST | `/api/external/landing/berita` | `landing:write` |
| PUT | `/api/external/landing/berita/:id` | `landing:write` |
| DELETE | `/api/external/landing/berita/:id` | `landing:delete` |

### Struktur Organisasi

| Method | Endpoint | Permission |
|---|---|---|
| GET | `/api/external/landing/struktur` | `landing:read` |
| POST | `/api/external/landing/struktur` | `landing:write` |
| PUT | `/api/external/landing/struktur/:id` | `landing:write` |
| DELETE | `/api/external/landing/struktur/:id` | `landing:delete` |

### Feedback

| Method | Endpoint | Permission |
|---|---|---|
| GET | `/api/external/landing/feedback` | `landing:read` |
| PUT | `/api/external/landing/feedback/:id/read` | `landing:write` |
| DELETE | `/api/external/landing/feedback/:id` | `landing:delete` |

### Merchandise

| Method | Endpoint | Permission |
|---|---|---|
| GET | `/api/external/landing/merchandise` | `landing:read` |
| GET | `/api/external/landing/merchandise/:id` | `landing:read` |
| POST | `/api/external/landing/merchandise` | `landing:write` |
| PUT | `/api/external/landing/merchandise/:id` | `landing:write` |
| DELETE | `/api/external/landing/merchandise/:id` | `landing:delete` |

**Merchandise Fields (multipart/form-data):**

| Field | Tipe | Keterangan |
|---|---|---|
| `nama` | string | Nama merchandise |
| `deskripsi` | string | Deskripsi produk |
| `harga` | decimal | Harga (e.g. 150000.00) |
| `gambar` | file | Foto produk (JPG/PNG/WEBP, maks 5MB) |
| `link` | string | Link pembelian eksternal |
| `urutan` | integer | Urutan tampil |
| `aktif` | boolean | Status aktif/nonaktif |

### Site Config (Landing)

| Method | Endpoint | Permission |
|---|---|---|
| GET | `/api/external/landing/config` | `landing:read` |
| PUT | `/api/external/landing/config` | `landing:write` |

---

## Upload File

**Konfigurasi:**
- Maks ukuran: **5MB** per file
- Tipe yang diizinkan: `JPEG`, `PNG`, `WEBP`, `PDF`, `DOC`, `DOCX`, `XLS`, `XLSX`
- File disimpan di `/uploads/` dan diakses via URL: `https://<domain>/uploads/<filename>`

**Error Upload:**
```json
{
  "error": "Ukuran file terlalu besar. Maksimal 5MB per file."
}
```

```json
{
  "error": "Tipe file tidak diizinkan. Gunakan JPG, PNG, WEBP, PDF, DOC, DOCX, XLS, atau XLSX."
}
```

---

## Database Schema (RekomendasiEvent)

| Field | Tipe | Keterangan |
|---|---|---|
| `id` | int | Primary key, auto-increment |
| `namaEvent` | string | Nama event (wajib) |
| `jenisEvent` | string? | Lomba, Festival, Pelatihan, Seminar, Lainnya |
| `tanggalMulai` | datetime? | Tanggal mulai |
| `tanggalSelesai` | datetime? | Tanggal selesai |
| `lokasi` | string? | Lokasi penyelenggaraan |
| `deskripsi` | text? | Deskripsi event |
| `penyelenggara` | string? | Nama penyelenggara |
| `kontakPerson` | string? | Nomor kontak |
| `noBilingSimpaskor` | string? | Nomor billing SIMPASKOR |
| `dokumenSurat` | string? | Path file dokumen surat |
| `persyaratan` | json? | Data persyaratan (checkbox, text, file paths) |
| `mataLomba` | json? | Data mata lomba dengan jadwal |
| `proposal` | string? | Path file proposal kegiatan |
| `poster` | string? | Path file poster event |
| `status` | enum | DRAFT, PENDING, APPROVED_PENGCAB, DISETUJUI, DITOLAK |
| `catatanPengcab` | text? | Catatan dari pengcab |
| `catatanAdmin` | text? | Catatan dari admin/pengda |
| `approvedPengcabAt` | datetime? | Timestamp approval pengcab |
| `approvedPengdaAt` | datetime? | Timestamp approval pengda |
| `nomorSurat` | string? | Auto: UM.001/FORBASI-JABAR/II/2026 |
| `suratRekomendasi` | string? | Path file surat PDF yang digenerate |
| `userId` | int | FK ke user yang mengajukan |
| `pengcabId` | int? | FK ke pengcab terkait |
| `createdAt` | datetime | Timestamp dibuat |
| `updatedAt` | datetime | Timestamp terakhir diupdate |

---

## Contoh Integrasi (JavaScript/Node.js)

```javascript
const API_BASE = 'https://<domain>/api/external';
const API_KEY = '<your-api-key>';

// Get semua rekomendasi yang pending
const response = await fetch(`${API_BASE}/rekomendasi?status=PENDING`, {
  headers: { 'X-API-Key': API_KEY }
});
const data = await response.json();

// Approve rekomendasi (level pengda)
await fetch(`${API_BASE}/rekomendasi/1/status`, {
  method: 'PATCH',
  headers: {
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    status: 'DISETUJUI',
    catatanAdmin: 'Disetujui oleh Pusat'
  })
});

// Get statistik dashboard
const stats = await fetch(`${API_BASE}/dashboard/stats`, {
  headers: { 'X-API-Key': API_KEY }
});
```
