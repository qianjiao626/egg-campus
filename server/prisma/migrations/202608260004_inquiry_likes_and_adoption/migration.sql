ALTER TABLE `inquiries`
  ADD COLUMN `adopted_reply_id` BIGINT NULL,
  ADD INDEX `inquiries_adopted_reply_id_idx` (`adopted_reply_id`);

CREATE TABLE `inquiry_likes` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `inquiry_id` BIGINT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `inquiry_likes_inquiry_id_user_id_key` (`inquiry_id`, `user_id`),
  KEY `inquiry_likes_user_id_created_at_idx` (`user_id`, `created_at`),
  CONSTRAINT `inquiry_likes_inquiry_id_fkey` FOREIGN KEY (`inquiry_id`) REFERENCES `inquiries` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `inquiry_likes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `inquiry_reply_likes` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `reply_id` BIGINT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `inquiry_reply_likes_reply_id_user_id_key` (`reply_id`, `user_id`),
  KEY `inquiry_reply_likes_user_id_created_at_idx` (`user_id`, `created_at`),
  CONSTRAINT `inquiry_reply_likes_reply_id_fkey` FOREIGN KEY (`reply_id`) REFERENCES `inquiry_replies` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `inquiry_reply_likes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
