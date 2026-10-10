-- Setelan arena voting yang disamakan dengan Simpaskor.

-- Panel kiri arena publik (papan & riwayat pendukung) dan cara menampilkan
-- perolehan kontestan: "JUMLAH" (angka vote) atau "PERSEN" (persentase dari
-- total vote kategori). Panel menyala secara bawaan supaya arena yang sudah
-- berjalan tidak kehilangan panelnya diam-diam.
ALTER TABLE `event_voting_configs`
  ADD COLUMN `tampilkan_papan_pendukung` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `tampilkan_riwayat_pendukung` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `tampilan_vote` VARCHAR(10) NOT NULL DEFAULT 'JUMLAH';

-- Jadwal buka/tutup per kategori. ikuti_jadwal_arena = true (bawaan) berarti
-- mengikuti jadwal arena; false memakai start/end sendiri yang selalu dijepit
-- DI DALAM jadwal arena.
ALTER TABLE `voting_categories`
  ADD COLUMN `ikuti_jadwal_arena` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `start_date` DATETIME(3) NULL,
  ADD COLUMN `end_date` DATETIME(3) NULL;

-- Batas vote gratis per orang: NOL = tanpa batas (seperti Simpaskor). Kolom ini
-- dulu bernilai bawaan 1 tetapi tidak pernah ditegakkan, jadi semua kategori
-- yang ada sebenarnya berjalan tanpa batas — nilainya disetel 0 supaya
-- menegakkannya sekarang tidak diam-diam membatasi arena yang sedang jalan.
ALTER TABLE `voting_categories`
  ALTER COLUMN `max_votes_per_voter` SET DEFAULT 0;
UPDATE `voting_categories` SET `max_votes_per_voter` = 0;
