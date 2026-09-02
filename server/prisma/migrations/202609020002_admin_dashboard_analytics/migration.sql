CREATE TABLE IF NOT EXISTS `analytics_events` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NULL,
  `event_type` VARCHAR(50) NOT NULL,
  `event_data` JSON NULL,
  `page` VARCHAR(100) NULL,
  `ip` VARCHAR(45) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `analytics_events_event_type_created_at_idx` (`event_type`, `created_at`),
  INDEX `analytics_events_user_id_created_at_idx` (`user_id`, `created_at`),
  INDEX `analytics_events_created_at_idx` (`created_at`),
  CONSTRAINT `analytics_events_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
