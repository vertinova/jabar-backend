-- E-Ticketing: konfigurasi per event, jenis tiket, pesanan, dan tiket per penonton.
--
-- Kolom kuota (`quota`) sengaja NULL-able: NULL berarti tanpa batas, 0 berarti
-- benar-benar tidak ada yang bisa terjual.

-- CreateTable
CREATE TABLE `event_ticket_configs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `rekomendasi_event_id` INTEGER NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `price` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `quota` INTEGER NULL,
    `sold_count` INTEGER NOT NULL DEFAULT 0,
    `description` TEXT NULL,
    `sales_start_date` DATETIME(3) NULL,
    `sales_end_date` DATETIME(3) NULL,
    `approval_status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `approval_note` TEXT NULL,
    `approved_at` DATETIME(3) NULL,
    `organizer_share_percent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `pengda_share_percent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `developer_share_percent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `event_ticket_configs_rekomendasi_event_id_key`(`rekomendasi_event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticket_types` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `config_id` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `kind` ENUM('SINGLE', 'DAY', 'PASS') NOT NULL DEFAULT 'SINGLE',
    `price` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `quota` INTEGER NULL,
    `sold_count` INTEGER NOT NULL DEFAULT 0,
    `valid_date` DATETIME(3) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ticket_types_config_id_idx`(`config_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticket_orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `rekomendasi_event_id` INTEGER NOT NULL,
    `config_id` INTEGER NOT NULL,
    `ticket_type_id` INTEGER NULL,
    `user_id` INTEGER NULL,
    `buyer_name` VARCHAR(191) NOT NULL,
    `buyer_email` VARCHAR(191) NOT NULL,
    `buyer_phone` VARCHAR(191) NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `unit_price` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `total_amount` DECIMAL(12, 2) NOT NULL,
    `admin_fee` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `qris_fee` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `gross_amount` DECIMAL(12, 2) NULL,
    `order_code` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'PAID', 'USED', 'CANCELLED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
    `channel` ENUM('ONLINE', 'OTS_CASH', 'OTS_QRIS') NOT NULL DEFAULT 'ONLINE',
    `midtrans_order_id` VARCHAR(191) NULL,
    `snap_token` TEXT NULL,
    `payment_type` VARCHAR(191) NULL,
    `paid_at` DATETIME(3) NULL,
    `sold_by_id` INTEGER NULL,
    `note` TEXT NULL,
    `email_sent_at` DATETIME(3) NULL,
    `organizer_share_percent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `pengda_share_percent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `organizer_share_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `pengda_share_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ticket_orders_order_code_key`(`order_code`),
    UNIQUE INDEX `ticket_orders_midtrans_order_id_key`(`midtrans_order_id`),
    INDEX `ticket_orders_rekomendasi_event_id_idx`(`rekomendasi_event_id`),
    INDEX `ticket_orders_config_id_idx`(`config_id`),
    INDEX `ticket_orders_ticket_type_id_idx`(`ticket_type_id`),
    INDEX `ticket_orders_user_id_idx`(`user_id`),
    INDEX `ticket_orders_buyer_email_idx`(`buyer_email`),
    INDEX `ticket_orders_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticket_attendees` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_id` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `ticket_code` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'PAID', 'USED', 'CANCELLED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
    `used_at` DATETIME(3) NULL,
    `scanned_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ticket_attendees_ticket_code_key`(`ticket_code`),
    INDEX `ticket_attendees_order_id_idx`(`order_id`),
    INDEX `ticket_attendees_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `event_ticket_configs` ADD CONSTRAINT `event_ticket_configs_rekomendasi_event_id_fkey` FOREIGN KEY (`rekomendasi_event_id`) REFERENCES `rekomendasi_events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_types` ADD CONSTRAINT `ticket_types_config_id_fkey` FOREIGN KEY (`config_id`) REFERENCES `event_ticket_configs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_orders` ADD CONSTRAINT `ticket_orders_rekomendasi_event_id_fkey` FOREIGN KEY (`rekomendasi_event_id`) REFERENCES `rekomendasi_events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_orders` ADD CONSTRAINT `ticket_orders_config_id_fkey` FOREIGN KEY (`config_id`) REFERENCES `event_ticket_configs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_orders` ADD CONSTRAINT `ticket_orders_ticket_type_id_fkey` FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_types`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_orders` ADD CONSTRAINT `ticket_orders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_attendees` ADD CONSTRAINT `ticket_attendees_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `ticket_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
