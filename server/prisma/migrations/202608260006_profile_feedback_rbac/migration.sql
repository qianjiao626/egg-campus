ALTER TABLE `users`
  ADD COLUMN `nickname_changed_at` DATETIME(3) NULL,
  ADD COLUMN `must_change_password` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `protected_admin_key` VARCHAR(40) NULL,
  ADD COLUMN `interests` JSON NULL,
  ADD COLUMN `skills` JSON NULL,
  ADD UNIQUE INDEX `users_protected_admin_key_key` (`protected_admin_key`);

CREATE TABLE `roles` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(80) NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `description` VARCHAR(500) NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `system_protected` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `roles_code_key` (`code`),
  INDEX `roles_enabled_created_at_idx` (`enabled`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `permissions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `key` VARCHAR(100) NOT NULL,
  `resource` VARCHAR(50) NOT NULL,
  `action` VARCHAR(80) NOT NULL,
  `description` VARCHAR(500) NOT NULL,
  `risk` VARCHAR(20) NOT NULL DEFAULT 'normal',
  `protected` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `permissions_key_key` (`key`),
  INDEX `permissions_resource_action_idx` (`resource`, `action`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `role_permissions` (
  `role_id` BIGINT NOT NULL,
  `permission_id` BIGINT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `role_permissions_permission_id_idx` (`permission_id`),
  PRIMARY KEY (`role_id`, `permission_id`),
  CONSTRAINT `role_permissions_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `role_permissions_permission_id_fkey` FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_role_grants` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `role_id` BIGINT NOT NULL,
  `granted_by` BIGINT NULL,
  `starts_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expires_at` DATETIME(3) NULL,
  `is_permanent` BOOLEAN NOT NULL DEFAULT false,
  `revoked_at` DATETIME(3) NULL,
  `revoked_by` BIGINT NULL,
  `revoke_reason` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `user_role_grants_user_id_revoked_at_starts_at_expires_at_idx` (`user_id`, `revoked_at`, `starts_at`, `expires_at`),
  INDEX `user_role_grants_role_id_revoked_at_idx` (`role_id`, `revoked_at`),
  INDEX `user_role_grants_granted_by_idx` (`granted_by`),
  INDEX `user_role_grants_revoked_by_idx` (`revoked_by`),
  PRIMARY KEY (`id`),
  CONSTRAINT `user_role_grants_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `user_role_grants_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `user_role_grants_granted_by_fkey` FOREIGN KEY (`granted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `user_role_grants_revoked_by_fkey` FOREIGN KEY (`revoked_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `role_grant_audits` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `grant_id` BIGINT NULL,
  `actor_id` BIGINT NULL,
  `action` VARCHAR(40) NOT NULL,
  `before_data` JSON NULL,
  `after_data` JSON NULL,
  `reason` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `role_grant_audits_grant_id_created_at_idx` (`grant_id`, `created_at`),
  INDEX `role_grant_audits_actor_id_created_at_idx` (`actor_id`, `created_at`),
  INDEX `role_grant_audits_action_created_at_idx` (`action`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `role_grant_audits_grant_id_fkey` FOREIGN KEY (`grant_id`) REFERENCES `user_role_grants` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `role_grant_audits_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `feedback`
  ADD COLUMN `closed_at` DATETIME(3) NULL,
  ADD COLUMN `reopened_at` DATETIME(3) NULL,
  ADD COLUMN `reopen_count` INT NOT NULL DEFAULT 0;

CREATE TABLE `feedback_messages` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `feedback_id` BIGINT NOT NULL,
  `author_id` BIGINT NULL,
  `author_type` VARCHAR(20) NOT NULL,
  `content` TEXT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `feedback_messages_feedback_id_created_at_idx` (`feedback_id`, `created_at`),
  INDEX `feedback_messages_author_id_created_at_idx` (`author_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `feedback_messages_feedback_id_fkey` FOREIGN KEY (`feedback_id`) REFERENCES `feedback` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `feedback_messages_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `feedback_attachments` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `feedback_id` BIGINT NOT NULL,
  `message_id` BIGINT NULL,
  `uploader_id` BIGINT NOT NULL,
  `storage_key` VARCHAR(120) NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(80) NOT NULL,
  `size_bytes` INT NOT NULL,
  `hidden_at` DATETIME(3) NULL,
  `hidden_by` BIGINT NULL,
  `hidden_reason` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `feedback_attachments_storage_key_key` (`storage_key`),
  INDEX `feedback_attachments_feedback_id_created_at_idx` (`feedback_id`, `created_at`),
  INDEX `feedback_attachments_message_id_idx` (`message_id`),
  INDEX `feedback_attachments_uploader_id_idx` (`uploader_id`),
  INDEX `feedback_attachments_hidden_by_idx` (`hidden_by`),
  PRIMARY KEY (`id`),
  CONSTRAINT `feedback_attachments_feedback_id_fkey` FOREIGN KEY (`feedback_id`) REFERENCES `feedback` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `feedback_attachments_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `feedback_messages` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `feedback_attachments_uploader_id_fkey` FOREIGN KEY (`uploader_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `feedback_attachments_hidden_by_fkey` FOREIGN KEY (`hidden_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `resource_read_states` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `resource_type` VARCHAR(40) NOT NULL,
  `resource_id` VARCHAR(100) NOT NULL,
  `last_message_id` BIGINT NULL,
  `last_read_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `resource_read_states_user_id_resource_type_resource_id_key` (`user_id`, `resource_type`, `resource_id`),
  INDEX `resource_read_states_user_id_resource_type_last_read_at_idx` (`user_id`, `resource_type`, `last_read_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `resource_read_states_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `feedback_messages` (`feedback_id`, `author_id`, `author_type`, `content`, `created_at`)
SELECT `id`, NULL, 'admin', `admin_remark`, `updated_at`
FROM `feedback`
WHERE `admin_remark` IS NOT NULL AND CHAR_LENGTH(TRIM(`admin_remark`)) > 0;

UPDATE `feedback`
SET
  `closed_at` = CASE
    WHEN `status` IN ('resolved', 'closed') THEN `updated_at`
    ELSE `closed_at`
  END,
  `status` = CASE
    WHEN `status` = 'open' THEN 'pending'
    WHEN `status` = 'processing' THEN 'processing'
    WHEN `status` IN ('resolved', 'closed') THEN 'resolved'
    ELSE `status`
  END;
