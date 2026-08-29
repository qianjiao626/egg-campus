CREATE TABLE `task_cancellation_requests` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `task_id` BIGINT NOT NULL,
  `requester_id` BIGINT NOT NULL,
  `recipient_id` BIGINT NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `responded_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `task_cancellation_requests_task_id_status_created_at_idx` (`task_id`, `status`, `created_at`),
  INDEX `task_cancellation_requests_requester_id_created_at_idx` (`requester_id`, `created_at`),
  INDEX `task_cancellation_requests_recipient_id_status_created_at_idx` (`recipient_id`, `status`, `created_at`),
  CONSTRAINT `task_cancellation_requests_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `task_cancellation_requests_requester_id_fkey` FOREIGN KEY (`requester_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `task_cancellation_requests_recipient_id_fkey` FOREIGN KEY (`recipient_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
