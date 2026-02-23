-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `role` ENUM('ADMIN', 'USER') NOT NULL DEFAULT 'USER',
    `phone` VARCHAR(191) NULL,
    `avatar` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pengcab` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nama` VARCHAR(191) NOT NULL,
    `kota` VARCHAR(191) NOT NULL,
    `ketua` VARCHAR(191) NOT NULL,
    `sekretaris` VARCHAR(191) NULL,
    `bendahara` VARCHAR(191) NULL,
    `alamat` TEXT NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `logo` VARCHAR(191) NULL,
    `status` ENUM('AKTIF', 'NONAKTIF') NOT NULL DEFAULT 'AKTIF',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rekomendasi_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `namaEvent` VARCHAR(191) NOT NULL,
    `jenisEvent` VARCHAR(191) NOT NULL,
    `tanggalMulai` DATETIME(3) NOT NULL,
    `tanggalSelesai` DATETIME(3) NOT NULL,
    `lokasi` VARCHAR(191) NOT NULL,
    `deskripsi` TEXT NULL,
    `penyelenggara` VARCHAR(191) NOT NULL,
    `kontakPerson` VARCHAR(191) NULL,
    `dokumenSurat` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'DISETUJUI', 'DITOLAK') NOT NULL DEFAULT 'PENDING',
    `catatanAdmin` TEXT NULL,
    `userId` INTEGER NOT NULL,
    `pengcabId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kejurda` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `namaKejurda` VARCHAR(191) NOT NULL,
    `tanggalMulai` DATETIME(3) NOT NULL,
    `tanggalSelesai` DATETIME(3) NOT NULL,
    `lokasi` VARCHAR(191) NOT NULL,
    `deskripsi` TEXT NULL,
    `poster` VARCHAR(191) NULL,
    `statusBuka` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pendaftaran_kejurda` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kejurdaId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `pengcabId` INTEGER NULL,
    `namaAtlet` VARCHAR(191) NOT NULL,
    `kategori` VARCHAR(191) NOT NULL,
    `kelasTanding` VARCHAR(191) NULL,
    `dokumen` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'DISETUJUI', 'DITOLAK') NOT NULL DEFAULT 'PENDING',
    `catatanAdmin` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `rekomendasi_events` ADD CONSTRAINT `rekomendasi_events_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rekomendasi_events` ADD CONSTRAINT `rekomendasi_events_pengcabId_fkey` FOREIGN KEY (`pengcabId`) REFERENCES `pengcab`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pendaftaran_kejurda` ADD CONSTRAINT `pendaftaran_kejurda_kejurdaId_fkey` FOREIGN KEY (`kejurdaId`) REFERENCES `kejurda`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pendaftaran_kejurda` ADD CONSTRAINT `pendaftaran_kejurda_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pendaftaran_kejurda` ADD CONSTRAINT `pendaftaran_kejurda_pengcabId_fkey` FOREIGN KEY (`pengcabId`) REFERENCES `pengcab`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
