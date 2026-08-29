CREATE TABLE `shop_products` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `publisher_id` BIGINT NULL,
  `publisher_nickname` VARCHAR(50) NULL,
  `name` VARCHAR(120) NOT NULL,
  `type` ENUM('virtual', 'physical') NOT NULL,
  `category` VARCHAR(60) NULL,
  `summary` VARCHAR(240) NULL,
  `description` TEXT NOT NULL,
  `price` INT NOT NULL,
  `stock` INT NULL,
  `unlimited_stock` BOOLEAN NOT NULL DEFAULT false,
  `min_quantity` INT NOT NULL DEFAULT 1,
  `max_quantity` INT NOT NULL DEFAULT 1,
  `virtual_type` VARCHAR(60) NULL,
  `fulfillment_data` JSON NULL,
  `status` ENUM('draft', 'pending_review', 'rejected', 'approved', 'on_sale', 'off_sale', 'archived', 'sold_out') NOT NULL DEFAULT 'draft',
  `review_reason` VARCHAR(500) NULL,
  `reviewed_by` BIGINT NULL,
  `reviewed_at` DATETIME(3) NULL,
  `published_at` DATETIME(3) NULL,
  `archived_at` DATETIME(3) NULL,
  `view_count` INT NOT NULL DEFAULT 0,
  `sales_count` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `shop_products_status_published_at_idx` (`status`, `published_at`),
  INDEX `shop_products_publisher_id_status_created_at_idx` (`publisher_id`, `status`, `created_at`),
  INDEX `shop_products_category_status_idx` (`category`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `shop_product_images` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `product_id` BIGINT NOT NULL,
  `url` VARCHAR(500) NOT NULL,
  `kind` VARCHAR(20) NOT NULL DEFAULT 'detail',
  `sort_order` INT NOT NULL DEFAULT 0,
  `deleted_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `shop_product_images_product_id_kind_sort_order_idx` (`product_id`, `kind`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `shop_cart_items` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `quantity` INT NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `shop_cart_items_user_id_updated_at_idx` (`user_id`, `updated_at`),
  UNIQUE INDEX `shop_cart_items_user_id_product_id_key` (`user_id`, `product_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `shipping_addresses` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `recipient_name` VARCHAR(50) NOT NULL,
  `phone` VARCHAR(20) NOT NULL,
  `province` VARCHAR(50) NOT NULL,
  `city` VARCHAR(50) NOT NULL,
  `district` VARCHAR(50) NOT NULL,
  `detail` VARCHAR(300) NOT NULL,
  `postal_code` VARCHAR(10) NULL,
  `is_default` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `shipping_addresses_user_id_is_default_idx` (`user_id`, `is_default`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `shop_orders` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `status` ENUM('paid', 'awaiting_shipment', 'shipped', 'completed', 'cancel_requested', 'cancelled', 'refunding', 'refunded', 'failed') NOT NULL DEFAULT 'paid',
  `total_amount` INT NOT NULL,
  `needs_shipment` BOOLEAN NOT NULL DEFAULT false,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `address_id` BIGINT NULL,
  `recipient_name` VARCHAR(50) NULL,
  `phone` VARCHAR(20) NULL,
  `address_snapshot` JSON NULL,
  `carrier` VARCHAR(60) NULL,
  `tracking_number` VARCHAR(100) NULL,
  `shipped_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `cancelled_at` DATETIME(3) NULL,
  `cancel_reason` VARCHAR(500) NULL,
  `refunded_at` DATETIME(3) NULL,
  `refund_reason` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `shop_orders_idempotency_key_key` (`idempotency_key`),
  INDEX `shop_orders_user_id_status_created_at_idx` (`user_id`, `status`, `created_at`),
  INDEX `shop_orders_status_created_at_idx` (`status`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `shop_order_items` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `product_name` VARCHAR(120) NOT NULL,
  `product_type` ENUM('virtual', 'physical') NOT NULL,
  `unit_price` INT NOT NULL,
  `quantity` INT NOT NULL,
  `fulfillment_status` VARCHAR(30) NOT NULL DEFAULT 'pending',
  `fulfillment_data` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `shop_order_items_order_id_idx` (`order_id`),
  INDEX `shop_order_items_product_id_created_at_idx` (`product_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_entitlements` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `order_item_id` BIGINT NOT NULL,
  `type` VARCHAR(60) NOT NULL,
  `payload` JSON NOT NULL,
  `status` ENUM('active', 'used', 'expired', 'revoked') NOT NULL DEFAULT 'active',
  `acquired_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expires_at` DATETIME(3) NULL,
  `used_at` DATETIME(3) NULL,
  INDEX `user_entitlements_user_id_status_acquired_at_idx` (`user_id`, `status`, `acquired_at`),
  INDEX `user_entitlements_product_id_acquired_at_idx` (`product_id`, `acquired_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `product_redeem_codes` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `product_id` BIGINT NOT NULL,
  `order_item_id` BIGINT NULL,
  `code_hash` VARCHAR(128) NOT NULL,
  `code_mask` VARCHAR(80) NOT NULL,
  `code_ciphertext` TEXT NOT NULL,
  `status` ENUM('available', 'assigned', 'used', 'disabled') NOT NULL DEFAULT 'available',
  `assigned_at` DATETIME(3) NULL,
  `used_at` DATETIME(3) NULL,
  INDEX `product_redeem_codes_product_id_status_idx` (`product_id`, `status`),
  INDEX `product_redeem_codes_order_item_id_idx` (`order_item_id`),
  UNIQUE INDEX `product_redeem_codes_product_id_code_hash_key` (`product_id`, `code_hash`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `product_reviews` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `product_id` BIGINT NOT NULL,
  `order_item_id` BIGINT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `rating` INT NOT NULL,
  `content` TEXT NULL,
  `visible` BOOLEAN NOT NULL DEFAULT true,
  `hidden_reason` VARCHAR(500) NULL,
  `hidden_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `product_reviews_product_id_visible_created_at_idx` (`product_id`, `visible`, `created_at`),
  INDEX `product_reviews_user_id_created_at_idx` (`user_id`, `created_at`),
  UNIQUE INDEX `product_reviews_order_item_id_key` (`order_item_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `shop_products`
  ADD CONSTRAINT `shop_products_publisher_id_fkey` FOREIGN KEY (`publisher_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `shop_product_images`
  ADD CONSTRAINT `shop_product_images_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `shop_products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `shop_cart_items`
  ADD CONSTRAINT `shop_cart_items_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `shop_cart_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `shop_products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `shipping_addresses`
  ADD CONSTRAINT `shipping_addresses_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `shop_orders`
  ADD CONSTRAINT `shop_orders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `shop_orders_address_id_fkey` FOREIGN KEY (`address_id`) REFERENCES `shipping_addresses` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `shop_order_items`
  ADD CONSTRAINT `shop_order_items_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `shop_orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `shop_order_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `shop_products` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `user_entitlements`
  ADD CONSTRAINT `user_entitlements_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `user_entitlements_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `shop_products` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `user_entitlements_order_item_id_fkey` FOREIGN KEY (`order_item_id`) REFERENCES `shop_order_items` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `product_redeem_codes`
  ADD CONSTRAINT `product_redeem_codes_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `shop_products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `product_redeem_codes_order_item_id_fkey` FOREIGN KEY (`order_item_id`) REFERENCES `shop_order_items` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `product_reviews`
  ADD CONSTRAINT `product_reviews_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `shop_products` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `product_reviews_order_item_id_fkey` FOREIGN KEY (`order_item_id`) REFERENCES `shop_order_items` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `product_reviews_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
