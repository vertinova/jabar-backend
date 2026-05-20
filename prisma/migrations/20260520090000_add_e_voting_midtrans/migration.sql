-- Add Midtrans payment metadata and selected voting target.

ALTER TABLE `voting_purchases`
  ADD COLUMN `category_id` INTEGER NULL,
  ADD COLUMN `nominee_id` INTEGER NULL,
  ADD COLUMN `admin_fee` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `qris_fee` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `gross_amount` DECIMAL(12, 2) NULL,
  ADD COLUMN `midtrans_order_id` VARCHAR(191) NULL,
  ADD COLUMN `snap_token` VARCHAR(191) NULL,
  ADD COLUMN `payment_type` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `voting_purchases_midtrans_order_id_key` ON `voting_purchases`(`midtrans_order_id`);
CREATE INDEX `voting_purchases_category_id_idx` ON `voting_purchases`(`category_id`);
CREATE INDEX `voting_purchases_nominee_id_idx` ON `voting_purchases`(`nominee_id`);
