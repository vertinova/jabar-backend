-- Distinguishes who a withdrawal pays out: ORGANIZER (penyelenggara request flow),
-- or PENGDA / DEVELOPER global pool payouts recorded directly by the super admin.

ALTER TABLE `withdrawal_requests`
  ADD COLUMN `beneficiary_type` ENUM('ORGANIZER', 'PENGDA', 'DEVELOPER') NOT NULL DEFAULT 'ORGANIZER';

CREATE INDEX `withdrawal_requests_beneficiary_type_idx` ON `withdrawal_requests`(`beneficiary_type`);
