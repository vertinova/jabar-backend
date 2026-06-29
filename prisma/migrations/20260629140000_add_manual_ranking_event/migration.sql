-- Tandai event manual (dibuat Komisi Perlombaan untuk hasil juara event lama).
ALTER TABLE `rekomendasi_events` ADD COLUMN `is_manual_ranking` BOOLEAN NOT NULL DEFAULT false;
