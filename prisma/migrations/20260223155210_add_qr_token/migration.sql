/*
  Warnings:

  - A unique constraint covering the columns `[qrToken]` on the table `pendaftaran_kejurda` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `pendaftaran_kejurda` ADD COLUMN `qrToken` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `pendaftaran_kejurda_qrToken_key` ON `pendaftaran_kejurda`(`qrToken`);
