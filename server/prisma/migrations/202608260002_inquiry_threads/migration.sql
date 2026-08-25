ALTER TABLE `inquiries`
  ADD COLUMN `tags` JSON NULL,
  ADD COLUMN `coin_status` VARCHAR(20) NOT NULL DEFAULT 'open',
  ADD COLUMN `likes` INT NOT NULL DEFAULT 0,
  ADD COLUMN `adopted` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `deadline` DATETIME(3) NULL;

UPDATE `inquiries` SET `tags` = JSON_ARRAY() WHERE `tags` IS NULL;

ALTER TABLE `inquiries`
  MODIFY COLUMN `tags` JSON NOT NULL;

ALTER TABLE `inquiry_replies`
  ADD COLUMN `kind` VARCHAR(20) NOT NULL DEFAULT 'answer',
  ADD COLUMN `parent_id` BIGINT NULL,
  ADD INDEX `inquiry_replies_parent_id_idx` (`parent_id`);
