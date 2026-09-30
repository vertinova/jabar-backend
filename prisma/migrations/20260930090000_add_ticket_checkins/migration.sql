-- Log masuk gerbang e-ticketing: satu baris per penonton yang masuk.
CREATE TABLE `ticket_checkins` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `rekomendasi_event_id` INTEGER NOT NULL,
    `order_id` INTEGER NOT NULL,
    `attendee_id` INTEGER NULL,
    `scanned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `scanned_by_id` INTEGER NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'SCAN',

    INDEX `ticket_checkins_rekomendasi_event_id_scanned_at_idx`(`rekomendasi_event_id`, `scanned_at`),
    INDEX `ticket_checkins_order_id_idx`(`order_id`),
    INDEX `ticket_checkins_attendee_id_idx`(`attendee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ticket_checkins` ADD CONSTRAINT `ticket_checkins_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `ticket_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ticket_checkins` ADD CONSTRAINT `ticket_checkins_attendee_id_fkey` FOREIGN KEY (`attendee_id`) REFERENCES `ticket_attendees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Isi ulang dari tiket yang sudah terpakai sebelum tabel ini ada, supaya daftar
-- "baru saja masuk" tidak kosong untuk event yang sedang berjalan.
INSERT INTO `ticket_checkins` (`rekomendasi_event_id`, `order_id`, `attendee_id`, `scanned_at`, `scanned_by_id`, `source`)
SELECT o.`rekomendasi_event_id`, a.`order_id`, a.`id`, a.`used_at`, a.`scanned_by_id`, 'BACKFILL'
FROM `ticket_attendees` a
JOIN `ticket_orders` o ON o.`id` = a.`order_id`
WHERE a.`status` = 'USED' AND a.`used_at` IS NOT NULL;
