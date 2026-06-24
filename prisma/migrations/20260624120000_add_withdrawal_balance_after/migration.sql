-- Snapshot of the organizer's remaining balance (saldo akhir) recorded when a
-- withdrawal is marked PAID.

ALTER TABLE `withdrawal_requests`
  ADD COLUMN `balance_after` DECIMAL(12, 2) NULL;
