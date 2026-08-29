ALTER TABLE `tasks`
  ADD COLUMN `skill_category` VARCHAR(50) NULL,
  ADD COLUMN `skill_subcategory` VARCHAR(50) NULL;

CREATE TABLE `invitations` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `inviter_id` BIGINT NOT NULL,
  `invited_user_id` BIGINT NOT NULL,
  `invite_code` VARCHAR(20) NOT NULL,
  `rewarded_at` DATETIME(3) NULL,
  `rewarded_task_id` BIGINT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `invitations_invited_user_id_key` (`invited_user_id`),
  INDEX `invitations_inviter_id_created_at_idx` (`inviter_id`, `created_at`),
  INDEX `invitations_rewarded_at_created_at_idx` (`rewarded_at`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `invitations_inviter_id_fkey` FOREIGN KEY (`inviter_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `invitations_invited_user_id_fkey` FOREIGN KEY (`invited_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
