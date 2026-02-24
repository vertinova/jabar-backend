-- AlterTable
ALTER TABLE `pendaftaran_kejurda` MODIFY `status` ENUM('DRAFT', 'PENDING', 'APPROVED_PENGCAB', 'DISETUJUI', 'DITOLAK') NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE `rekomendasi_events` ADD COLUMN `noBilingSimpaskor` VARCHAR(191) NULL,
    MODIFY `jenisEvent` VARCHAR(191) NULL,
    MODIFY `tanggalMulai` DATETIME(3) NULL,
    MODIFY `tanggalSelesai` DATETIME(3) NULL,
    MODIFY `lokasi` VARCHAR(191) NULL,
    MODIFY `penyelenggara` VARCHAR(191) NULL,
    MODIFY `status` ENUM('DRAFT', 'PENDING', 'APPROVED_PENGCAB', 'DISETUJUI', 'DITOLAK') NOT NULL DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE `format_dokumen` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nama` VARCHAR(191) NOT NULL,
    `deskripsi` VARCHAR(191) NULL,
    `filePath` VARCHAR(191) NOT NULL,
    `kategori` VARCHAR(191) NOT NULL DEFAULT 'umum',
    `urutan` INTEGER NOT NULL DEFAULT 0,
    `aktif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
