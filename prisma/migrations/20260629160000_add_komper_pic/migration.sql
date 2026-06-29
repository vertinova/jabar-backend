-- PIC KOMPER: akun komper yang boleh membuat/kelola akun komper lain.
ALTER TABLE `users` ADD COLUMN `is_komper_pic` BOOLEAN NOT NULL DEFAULT false;
