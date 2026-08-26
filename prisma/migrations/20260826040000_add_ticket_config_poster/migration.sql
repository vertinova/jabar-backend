-- Poster khusus penjualan tiket, terpisah dari poster berkas rekomendasi event.
-- NULL berarti halaman tiket memakai poster event seperti sebelumnya.
ALTER TABLE `event_ticket_configs` ADD COLUMN `poster` VARCHAR(191) NULL;
