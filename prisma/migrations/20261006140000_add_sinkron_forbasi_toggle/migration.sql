-- Izin menarik peserta Kejurda FORBASI pusat menjadi nominee, dipegang per event.
-- Default 0: event yang sudah ada tidak mendadak punya akses ke data pusat;
-- super admin yang menyalakannya satu per satu.
ALTER TABLE `event_voting_configs`
  ADD COLUMN `sinkron_forbasi_aktif` BOOLEAN NOT NULL DEFAULT false;
