ALTER TABLE `ratings`
  ADD COLUMN `is_dropout_vote` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `is_publisher_runaway_vote` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `tasks`
  ADD COLUMN `team_settled_at` DATETIME(3) NULL;
