-- Efek suara popup live yang dipilih sendiri oleh pembeli vote (slug berkas
-- public/sfx/<key>.mp3 di frontend). NULL = bunyi bawaan gift-nya.

ALTER TABLE `voting_purchases`
  ADD COLUMN `sfx_key` VARCHAR(40) NULL;
