ALTER TABLE `tasks`
  ADD COLUMN `task_type` VARCHAR(20) NOT NULL DEFAULT 'teach',
  ADD COLUMN `claim_mode` VARCHAR(20) NOT NULL DEFAULT 'single',
  ADD COLUMN `reward` INT NOT NULL DEFAULT 0,
  ADD COLUMN `max_claimers` INT NOT NULL DEFAULT 1,
  ADD COLUMN `contact` VARCHAR(160) NULL,
  ADD COLUMN `requirements` TEXT NULL;

CREATE TABLE `task_claims` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `task_id` BIGINT NOT NULL,
  `claimer_id` BIGINT NOT NULL,
  `contact` VARCHAR(160) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `frozen_amount` INT NOT NULL DEFAULT 0,
  `submitted_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `task_claims_task_id_claimer_id_key` (`task_id`, `claimer_id`),
  INDEX `task_claims_task_id_status_idx` (`task_id`, `status`),
  INDEX `task_claims_claimer_id_status_created_at_idx` (`claimer_id`, `status`, `created_at`),
  CONSTRAINT `task_claims_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `task_claims_claimer_id_fkey` FOREIGN KEY (`claimer_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ratings` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `task_id` BIGINT NOT NULL,
  `from_user_id` BIGINT NOT NULL,
  `to_user_id` BIGINT NOT NULL,
  `score` INT NOT NULL,
  `comment` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ratings_task_id_from_user_id_to_user_id_key` (`task_id`, `from_user_id`, `to_user_id`),
  INDEX `ratings_to_user_id_created_at_idx` (`to_user_id`, `created_at`),
  CONSTRAINT `ratings_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ratings_from_user_id_fkey` FOREIGN KEY (`from_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ratings_to_user_id_fkey` FOREIGN KEY (`to_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
