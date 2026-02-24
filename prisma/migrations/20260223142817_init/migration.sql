/*
  Warnings:

  - A unique constraint covering the columns `[forbasiId]` on the table `pengcab` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[username]` on the table `pengcab` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[forbasiId]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `kejurda` ADD COLUMN `batasPendaftaran` DATETIME(3) NULL,
    ADD COLUMN `biayaPendaftaran` DECIMAL(12, 2) NULL,
    ADD COLUMN `catatanAdmin` TEXT NULL,
    ADD COLUMN `jenisEvent` VARCHAR(191) NOT NULL DEFAULT 'KEJURDA',
    ADD COLUMN `kontakPerson` VARCHAR(191) NULL,
    ADD COLUMN `kontakPhone` VARCHAR(191) NULL,
    ADD COLUMN `pengcabId` INTEGER NULL,
    ADD COLUMN `statusApproval` VARCHAR(191) NOT NULL DEFAULT 'DISETUJUI',
    ADD COLUMN `targetPeserta` ENUM('CLUB', 'UMUM') NOT NULL DEFAULT 'CLUB';

-- AlterTable
ALTER TABLE `pendaftaran_kejurda` ADD COLUMN `catatanPeserta` TEXT NULL,
    ADD COLUMN `dataPersyaratan` JSON NULL,
    ADD COLUMN `guestEmail` VARCHAR(191) NULL,
    ADD COLUMN `guestPhone` VARCHAR(191) NULL,
    MODIFY `userId` INTEGER NULL;

-- AlterTable
ALTER TABLE `pengcab` ADD COLUMN `forbasiId` INTEGER NULL,
    ADD COLUMN `username` VARCHAR(191) NULL,
    MODIFY `ketua` VARCHAR(191) NOT NULL DEFAULT 'Belum ditentukan';

-- AlterTable
ALTER TABLE `rekomendasi_events` ADD COLUMN `mataLomba` JSON NULL,
    ADD COLUMN `persyaratan` JSON NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `forbasiId` INTEGER NULL,
    MODIFY `role` ENUM('ADMIN', 'PENGCAB', 'USER', 'PENYELENGGARA', 'UMUM') NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE `kategori_event` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kode` VARCHAR(191) NOT NULL,
    `nama` VARCHAR(191) NOT NULL,
    `warna` VARCHAR(191) NOT NULL DEFAULT 'green',
    `grup` VARCHAR(191) NOT NULL DEFAULT 'kegiatan',
    `urutan` INTEGER NOT NULL DEFAULT 0,
    `aktif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `kategori_event_kode_key`(`kode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `persyaratan_fields` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kejurdaId` INTEGER NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `tipe` ENUM('TEXT', 'TEXTAREA', 'NUMBER', 'DATE', 'SELECT', 'RADIO', 'CHECKBOX', 'FILE_IMAGE', 'FILE_PDF', 'FILE_ANY') NOT NULL DEFAULT 'TEXT',
    `required` BOOLEAN NOT NULL DEFAULT true,
    `options` JSON NULL,
    `keterangan` TEXT NULL,
    `urutan` INTEGER NOT NULL DEFAULT 0,
    `aktif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hero_slides` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `gambar` VARCHAR(191) NOT NULL,
    `caption` VARCHAR(191) NULL,
    `urutan` INTEGER NOT NULL DEFAULT 0,
    `aktif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `berita` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `judul` VARCHAR(191) NOT NULL,
    `ringkasan` TEXT NULL,
    `konten` LONGTEXT NULL,
    `gambar` VARCHAR(191) NULL,
    `penulis` VARCHAR(191) NULL,
    `aktif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `feedback` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nama` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `pesan` TEXT NOT NULL,
    `dibaca` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `site_config` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `site_config_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `struktur_organisasi` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `jabatan` VARCHAR(191) NOT NULL,
    `nama` VARCHAR(191) NOT NULL,
    `foto` VARCHAR(191) NULL,
    `urutan` INTEGER NOT NULL DEFAULT 0,
    `aktif` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `pengcab_forbasiId_key` ON `pengcab`(`forbasiId`);

-- CreateIndex
CREATE UNIQUE INDEX `pengcab_username_key` ON `pengcab`(`username`);

-- CreateIndex
CREATE UNIQUE INDEX `users_forbasiId_key` ON `users`(`forbasiId`);

-- AddForeignKey
ALTER TABLE `kejurda` ADD CONSTRAINT `kejurda_pengcabId_fkey` FOREIGN KEY (`pengcabId`) REFERENCES `pengcab`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `persyaratan_fields` ADD CONSTRAINT `persyaratan_fields_kejurdaId_fkey` FOREIGN KEY (`kejurdaId`) REFERENCES `kejurda`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
