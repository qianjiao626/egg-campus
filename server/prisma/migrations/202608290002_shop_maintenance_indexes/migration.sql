CREATE INDEX `shop_orders_status_completed_at_shipped_at_idx` ON `shop_orders`(`status`, `completed_at`, `shipped_at`);
CREATE INDEX `shop_products_status_publisher_id_idx` ON `shop_products`(`status`, `publisher_id`);
