-- Tarif biaya admin per event voting. NULL = ikut tarif bawaan aplikasi.
-- Sengaja nullable, bukan ber-default angka: "belum pernah diatur" dan
-- "diatur ke angka yang sama dengan bawaan" adalah dua hal berbeda, dan
-- hanya yang pertama yang ikut berubah saat tarif bawaan diubah.
ALTER TABLE `event_voting_configs`
  ADD COLUMN `admin_fee_per_vote` INTEGER NULL,
  ADD COLUMN `admin_fee_max` INTEGER NULL;
