CREATE TABLE `buddy_preferences` (
  `user_id` BIGINT NOT NULL,
  `mbti_type` VARCHAR(4) NULL,
  `hobbies` JSON NOT NULL,
  `today_actions` JSON NOT NULL,
  `province` VARCHAR(50) NULL,
  `city` VARCHAR(50) NULL,
  `district` VARCHAR(50) NULL,
  `stealth` BOOLEAN NOT NULL DEFAULT false,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `buddy_preferences_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `buddy_boxes` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `creator_id` BIGINT NOT NULL,
  `kind` VARCHAR(30) NOT NULL,
  `payload` JSON NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'open',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `buddy_boxes_creator_id_created_at_idx`(`creator_id`, `created_at`),
  CONSTRAINT `buddy_boxes_creator_id_fkey` FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `buddy_messages` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `sender_id` BIGINT NOT NULL,
  `recipient_id` BIGINT NOT NULL,
  `text` VARCHAR(180) NOT NULL,
  `source` VARCHAR(30) NULL,
  `read_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `buddy_messages_recipient_id_created_at_idx`(`recipient_id`, `created_at`),
  CONSTRAINT `buddy_messages_sender_id_fkey` FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `buddy_messages_recipient_id_fkey` FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `buddy_friend_requests` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `requester_id` BIGINT NOT NULL,
  `recipient_id` BIGINT NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), UNIQUE INDEX `buddy_friend_requests_requester_id_recipient_id_key`(`requester_id`, `recipient_id`), INDEX `buddy_friend_requests_recipient_id_status_idx`(`recipient_id`, `status`),
  CONSTRAINT `buddy_friend_requests_requester_id_fkey` FOREIGN KEY (`requester_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `buddy_friend_requests_recipient_id_fkey` FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
