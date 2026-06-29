-- Status aktif akun. Akun nonaktif tidak bisa login.
ALTER TABLE `users` ADD COLUMN `is_active` BOOLEAN NOT NULL DEFAULT true;
