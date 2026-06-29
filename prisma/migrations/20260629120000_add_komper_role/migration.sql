-- AlterTable: add KOMPER (Komisi Perlombaan) to the users.role enum
ALTER TABLE `users` MODIFY `role` ENUM('ADMIN', 'PENGCAB', 'USER', 'PENYELENGGARA', 'UMUM', 'SUPERADMIN', 'KOMPER') NOT NULL DEFAULT 'USER';
