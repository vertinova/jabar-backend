-- Mata lomba untuk pemisahan klasemen ranking (default LOBB, lainnya RUKIBRA).
ALTER TABLE `ranking_results` ADD COLUMN `mata_lomba` VARCHAR(191) NOT NULL DEFAULT 'LOBB';
