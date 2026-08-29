ALTER TABLE `schools`
  ADD COLUMN `type` VARCHAR(30) NULL,
  ADD COLUMN `province` VARCHAR(30) NULL,
  ADD COLUMN `city` VARCHAR(50) NULL,
  ADD COLUMN `is_985` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `is_211` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `is_double_first_class` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `is_user_added` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `added_by` BIGINT NULL,
  ADD COLUMN `status` ENUM('approved', 'pending', 'rejected') NOT NULL DEFAULT 'approved',
  ADD INDEX `schools_status_name_idx` (`status`, `name`),
  ADD INDEX `schools_added_by_idx` (`added_by`),
  ADD CONSTRAINT `schools_added_by_fkey` FOREIGN KEY (`added_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
