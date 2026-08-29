CREATE TABLE `schools` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(200) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `schools_name_key` (`name`),
  INDEX `schools_name_idx` (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `school_comments` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `school_id` BIGINT NOT NULL,
  `content` TEXT NULL,
  `average_score` DECIMAL(3,1) NOT NULL,
  `status` ENUM('approved', 'deleted') NOT NULL DEFAULT 'approved',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `school_comments_user_id_school_id_key` (`user_id`, `school_id`),
  INDEX `school_comments_school_id_status_created_at_idx` (`school_id`, `status`, `created_at`),
  CONSTRAINT `school_comments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `school_comments_school_id_fkey` FOREIGN KEY (`school_id`) REFERENCES `schools` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `school_scores` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `comment_id` BIGINT NOT NULL,
  `metric_key` VARCHAR(40) NOT NULL,
  `score` INTEGER NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `school_scores_comment_id_metric_key_key` (`comment_id`, `metric_key`),
  INDEX `school_scores_metric_key_score_idx` (`metric_key`, `score`),
  CONSTRAINT `school_scores_comment_id_fkey` FOREIGN KEY (`comment_id`) REFERENCES `school_comments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
