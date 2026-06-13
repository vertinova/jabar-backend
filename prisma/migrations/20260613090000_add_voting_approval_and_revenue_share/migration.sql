-- Add FORBASI Pusat approval and revenue-share configuration.

ALTER TABLE `event_voting_configs`
  ADD COLUMN `approval_status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  ADD COLUMN `organizer_share_percent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `pengda_share_percent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `approval_note` TEXT NULL,
  ADD COLUMN `approved_at` DATETIME(3) NULL;

-- Grandfather existing voting configurations so deployed events keep working.
UPDATE `event_voting_configs`
SET
  `approval_status` = 'APPROVED',
  `organizer_share_percent` = 100,
  `pengda_share_percent` = 0,
  `approved_at` = CURRENT_TIMESTAMP(3);

ALTER TABLE `voting_purchases`
  ADD COLUMN `organizer_share_percent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `pengda_share_percent` DECIMAL(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `organizer_share_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `pengda_share_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0;

-- Preserve historical paid revenue under the previous 100% organizer behavior.
UPDATE `voting_purchases`
SET
  `organizer_share_percent` = 100,
  `pengda_share_percent` = 0,
  `organizer_share_amount` = `total_amount`,
  `pengda_share_amount` = 0;
