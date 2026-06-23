-- Voter-submitted encouragement message attached to a vote purchase.

ALTER TABLE `voting_purchases`
  ADD COLUMN `support_message` VARCHAR(200) NULL;
