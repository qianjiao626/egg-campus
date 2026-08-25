ALTER TABLE `users`
  ADD COLUMN `verified_phone_at` DATETIME(3) NULL,
  ADD COLUMN `verified_email_at` DATETIME(3) NULL;

CREATE TABLE `verification_codes` (
  `id` VARCHAR(30) NOT NULL,
  `channel` VARCHAR(10) NOT NULL,
  `target` VARCHAR(100) NOT NULL,
  `purpose` VARCHAR(30) NOT NULL,
  `code_hash` VARCHAR(64) NOT NULL,
  `verification_token_hash` VARCHAR(64) NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `max_attempts` INTEGER NOT NULL DEFAULT 5,
  `expires_at` DATETIME(3) NOT NULL,
  `verified_at` DATETIME(3) NULL,
  `consumed_at` DATETIME(3) NULL,
  `request_ip` VARCHAR(45) NULL,
  `user_agent` VARCHAR(512) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `verification_codes_verification_token_hash_key` (`verification_token_hash`),
  INDEX `verification_codes_target_purpose_created_at_idx` (`target`, `purpose`, `created_at`),
  INDEX `verification_codes_expires_at_idx` (`expires_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
