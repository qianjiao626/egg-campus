CREATE TABLE `buddy_feature_records` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `feature` VARCHAR(40) NOT NULL,
  `action` VARCHAR(40) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'active',
  `payload` JSON NOT NULL,
  `result` JSON NULL,
  `idempotency_key` VARCHAR(160) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `buddy_feature_records_idempotency_key_key`(`idempotency_key`),
  INDEX `buddy_feature_records_user_id_feature_created_at_idx`(`user_id`, `feature`, `created_at`),
  INDEX `buddy_feature_records_feature_status_created_at_idx`(`feature`, `status`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `buddy_feature_records_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
