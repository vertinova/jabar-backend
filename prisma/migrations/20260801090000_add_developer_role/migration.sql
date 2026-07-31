-- AlterTable: add DEVELOPER to the users.role enum
ALTER TABLE `users` MODIFY `role` ENUM('ADMIN', 'PENGCAB', 'USER', 'PENYELENGGARA', 'UMUM', 'SUPERADMIN', 'KOMPER', 'DEVELOPER') NOT NULL DEFAULT 'USER';

-- AlterTable: username login untuk akun lokal (opsional, unik bila diisi)
ALTER TABLE `users` ADD COLUMN `username` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `users_username_key` ON `users`(`username`);
