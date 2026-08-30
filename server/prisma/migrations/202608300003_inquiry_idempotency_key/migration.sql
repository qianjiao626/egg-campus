ALTER TABLE `inquiries`
  ADD COLUMN `idempotency_key` VARCHAR(160) NULL,
  ADD UNIQUE INDEX `inquiries_idempotency_key_key` (`idempotency_key`);
