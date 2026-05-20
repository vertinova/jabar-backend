-- Add e-voting support for approved organizer recommendation events.

CREATE TABLE `event_voting_configs` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `rekomendasi_event_id` INTEGER NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `is_paid` BOOLEAN NOT NULL DEFAULT false,
  `price_per_vote` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  `start_date` DATETIME(3) NULL,
  `end_date` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `event_voting_configs_rekomendasi_event_id_key`(`rekomendasi_event_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `voting_categories` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `config_id` INTEGER NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `mode` ENUM('TEAM', 'PERSONAL') NOT NULL DEFAULT 'TEAM',
  `position` VARCHAR(191) NULL,
  `max_votes_per_voter` INTEGER NOT NULL DEFAULT 1,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `order` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `voting_categories_config_id_idx`(`config_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `voting_nominees` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `category_id` INTEGER NOT NULL,
  `nominee_name` VARCHAR(191) NOT NULL,
  `nominee_photo` VARCHAR(191) NULL,
  `nominee_subtitle` VARCHAR(191) NULL,
  `vote_count` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `voting_nominees_category_id_idx`(`category_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `voting_purchases` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `rekomendasi_event_id` INTEGER NOT NULL,
  `buyer_name` VARCHAR(191) NOT NULL,
  `buyer_email` VARCHAR(191) NOT NULL,
  `buyer_phone` VARCHAR(191) NULL,
  `vote_count` INTEGER NOT NULL DEFAULT 1,
  `total_amount` DECIMAL(12, 2) NOT NULL,
  `purchase_code` VARCHAR(191) NOT NULL,
  `status` ENUM('PENDING', 'PAID', 'EXPIRED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  `paid_at` DATETIME(3) NULL,
  `used_votes` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `voting_purchases_purchase_code_key`(`purchase_code`),
  INDEX `voting_purchases_rekomendasi_event_id_idx`(`rekomendasi_event_id`),
  INDEX `voting_purchases_buyer_email_idx`(`buyer_email`),
  INDEX `voting_purchases_purchase_code_idx`(`purchase_code`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `voting_votes` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `category_id` INTEGER NOT NULL,
  `nominee_id` INTEGER NOT NULL,
  `purchase_id` INTEGER NULL,
  `voter_name` VARCHAR(191) NULL,
  `voter_email` VARCHAR(191) NULL,
  `voter_ip` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `voting_votes_category_id_idx`(`category_id`),
  INDEX `voting_votes_nominee_id_idx`(`nominee_id`),
  INDEX `voting_votes_voter_email_category_id_idx`(`voter_email`, `category_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `event_voting_configs`
  ADD CONSTRAINT `event_voting_configs_rekomendasi_event_id_fkey`
  FOREIGN KEY (`rekomendasi_event_id`) REFERENCES `rekomendasi_events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `voting_categories`
  ADD CONSTRAINT `voting_categories_config_id_fkey`
  FOREIGN KEY (`config_id`) REFERENCES `event_voting_configs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `voting_nominees`
  ADD CONSTRAINT `voting_nominees_category_id_fkey`
  FOREIGN KEY (`category_id`) REFERENCES `voting_categories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `voting_purchases`
  ADD CONSTRAINT `voting_purchases_rekomendasi_event_id_fkey`
  FOREIGN KEY (`rekomendasi_event_id`) REFERENCES `rekomendasi_events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `voting_votes`
  ADD CONSTRAINT `voting_votes_category_id_fkey`
  FOREIGN KEY (`category_id`) REFERENCES `voting_categories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `voting_votes`
  ADD CONSTRAINT `voting_votes_nominee_id_fkey`
  FOREIGN KEY (`nominee_id`) REFERENCES `voting_nominees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `voting_votes`
  ADD CONSTRAINT `voting_votes_purchase_id_fkey`
  FOREIGN KEY (`purchase_id`) REFERENCES `voting_purchases`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
