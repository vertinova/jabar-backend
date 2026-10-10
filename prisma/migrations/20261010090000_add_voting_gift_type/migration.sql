-- Kartu gift (Api/Beruang/Roket/Singa) yang dipilih pembeli vote.
-- NULL berarti jumlah vote diatur sendiri tanpa kartu gift; popup booster
-- lalu memilih adegan dari jumlah vote-nya.

ALTER TABLE `voting_purchases`
  ADD COLUMN `gift_type` VARCHAR(20) NULL;

-- Feed popup booster membaca pembelian PAID terbaru per event.
CREATE INDEX `voting_purchases_rekomendasi_event_id_status_paid_at_idx`
  ON `voting_purchases`(`rekomendasi_event_id`, `status`, `paid_at`);
