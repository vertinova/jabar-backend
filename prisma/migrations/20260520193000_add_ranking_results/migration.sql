-- Store official event winner results used to build public FORBASI-style rankings.

CREATE TABLE `ranking_results` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `rekomendasi_event_id` INTEGER NOT NULL,
  `participant_name` VARCHAR(191) NOT NULL,
  `participant_key` VARCHAR(191) NOT NULL,
  `participant_type` VARCHAR(191) NOT NULL DEFAULT 'TEAM',
  `origin` VARCHAR(191) NULL,
  `category` VARCHAR(191) NOT NULL,
  `rank` INTEGER NOT NULL,
  `title` VARCHAR(191) NULL,
  `points` INTEGER NOT NULL,
  `notes` TEXT NULL,
  `created_by_id` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `ranking_results_rekomendasi_event_id_idx`(`rekomendasi_event_id`),
  INDEX `ranking_results_participant_key_idx`(`participant_key`),
  INDEX `ranking_results_points_idx`(`points`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ranking_results`
  ADD CONSTRAINT `ranking_results_rekomendasi_event_id_fkey`
  FOREIGN KEY (`rekomendasi_event_id`) REFERENCES `rekomendasi_events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
