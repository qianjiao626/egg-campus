-- Initial TencentDB for MySQL schema for user identity and point accounts.
CREATE TABLE `users` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `nickname` VARCHAR(50) NOT NULL,
  `email` VARCHAR(100) NULL,
  `phone` VARCHAR(20) NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` ENUM('student', 'admin') NOT NULL DEFAULT 'student',
  `status` ENUM('active', 'suspended', 'deleted') NOT NULL DEFAULT 'active',
  `school` VARCHAR(100) NULL,
  `major` VARCHAR(100) NULL,
  `city` VARCHAR(50) NULL,
  `grade` VARCHAR(20) NULL,
  `age` INT NULL,
  `bio` TEXT NULL,
  `mbti_type` VARCHAR(4) NULL,
  `mbti_group` VARCHAR(2) NULL,
  `likes` INT NOT NULL DEFAULT 0,
  `reputation` DECIMAL(3,2) NOT NULL DEFAULT 0,
  `egg_category` VARCHAR(20) NULL,
  `egg_rarity` ENUM('N', 'R', 'SR', 'SSR', 'UR') NOT NULL DEFAULT 'N',
  `invite_code` VARCHAR(20) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `last_login_at` DATETIME(3) NULL,
  UNIQUE INDEX `users_nickname_key`(`nickname`),
  UNIQUE INDEX `users_email_key`(`email`),
  UNIQUE INDEX `users_phone_key`(`phone`),
  UNIQUE INDEX `users_invite_code_key`(`invite_code`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `auth_sessions` (
  `id` VARCHAR(30) NOT NULL,
  `user_id` BIGINT NOT NULL,
  `refresh_token_hash` VARCHAR(255) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `revoked_at` DATETIME(3) NULL,
  `ip` VARCHAR(45) NULL,
  `user_agent` VARCHAR(512) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `auth_sessions_refresh_token_hash_key`(`refresh_token_hash`),
  INDEX `auth_sessions_user_id_idx`(`user_id`),
  INDEX `auth_sessions_expires_at_idx`(`expires_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `auth_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_stats` (
  `user_id` BIGINT NOT NULL,
  `knowledge` DECIMAL(3,1) NOT NULL DEFAULT 0,
  `skills` DECIMAL(3,1) NOT NULL DEFAULT 0,
  `charm` DECIMAL(3,1) NOT NULL DEFAULT 0,
  `money` DECIMAL(3,1) NOT NULL DEFAULT 0,
  `reputation` DECIMAL(3,2) NOT NULL DEFAULT 0,
  `completed_tasks` INT NOT NULL DEFAULT 0,
  `published_tasks` INT NOT NULL DEFAULT 0,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `user_stats_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_characters` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `category` VARCHAR(20) NOT NULL,
  `unlocked` BOOLEAN NOT NULL DEFAULT false,
  `count` INT NOT NULL DEFAULT 0,
  `is_current` BOOLEAN NOT NULL DEFAULT false,
  `unlocked_at` DATETIME(3) NULL,
  UNIQUE INDEX `user_characters_user_id_category_key`(`user_id`, `category`),
  PRIMARY KEY (`id`),
  CONSTRAINT `user_characters_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `point_accounts` (
  `user_id` BIGINT NOT NULL,
  `available_balance` INT NOT NULL DEFAULT 10,
  `frozen_balance` INT NOT NULL DEFAULT 0,
  `version` INT NOT NULL DEFAULT 0,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `point_accounts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `point_transactions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `type` VARCHAR(50) NOT NULL,
  `delta_available` INT NOT NULL,
  `delta_frozen` INT NOT NULL,
  `balance_available` INT NOT NULL,
  `balance_frozen` INT NOT NULL,
  `task_id` BIGINT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `operator_id` BIGINT NULL,
  `remark` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `point_transactions_idempotency_key_key`(`idempotency_key`),
  INDEX `point_transactions_user_id_created_at_idx`(`user_id`, `created_at`),
  INDEX `point_transactions_task_id_idx`(`task_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `point_transactions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `audit_logs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `actor_id` BIGINT NULL,
  `action` VARCHAR(100) NOT NULL,
  `target_type` VARCHAR(50) NOT NULL,
  `target_id` VARCHAR(100) NOT NULL,
  `before_data` JSON NULL,
  `after_data` JSON NULL,
  `ip` VARCHAR(45) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `audit_logs_actor_id_created_at_idx`(`actor_id`, `created_at`),
  INDEX `audit_logs_target_type_target_id_idx`(`target_type`, `target_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
