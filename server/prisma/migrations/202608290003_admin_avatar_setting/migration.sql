CREATE TABLE `admin_avatar_settings` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `singleton` VARCHAR(20) NOT NULL DEFAULT 'default',
  `asset_path` VARCHAR(160) NOT NULL,
  `updated_by` BIGINT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `admin_avatar_settings_singleton_key` (`singleton`),
  INDEX `admin_avatar_settings_updated_by_idx` (`updated_by`),
  PRIMARY KEY (`id`),
  CONSTRAINT `admin_avatar_settings_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
