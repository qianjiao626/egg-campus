ALTER TABLE `user_stats`
  ADD COLUMN `experience` INT NOT NULL DEFAULT 0,
  ADD COLUMN `daily_publish_date` DATETIME(3) NULL,
  ADD COLUMN `daily_publish_count` INT NOT NULL DEFAULT 0;

ALTER TABLE `tasks`
  ADD COLUMN `publish_exp_reward` INT NOT NULL DEFAULT 0;
