-- AlterTable
ALTER TABLE `pendaftaran_kejurda` MODIFY `status` ENUM('PENDING', 'APPROVED_PENGCAB', 'DISETUJUI', 'DITOLAK') NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE `rekomendasi_events` ADD COLUMN `approvedPengcabAt` DATETIME(3) NULL,
    ADD COLUMN `approvedPengdaAt` DATETIME(3) NULL,
    ADD COLUMN `catatanPengcab` TEXT NULL,
    MODIFY `status` ENUM('PENDING', 'APPROVED_PENGCAB', 'DISETUJUI', 'DITOLAK') NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE `users` ADD COLUMN `pengcabId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_pengcabId_fkey` FOREIGN KEY (`pengcabId`) REFERENCES `pengcab`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
