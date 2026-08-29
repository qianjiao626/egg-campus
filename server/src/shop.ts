import { z } from 'zod';

export const shopProductTypeSchema = z.enum(['virtual', 'physical']);
export const productStatusSchema = z.enum([
  'draft',
  'pending_review',
  'rejected',
  'approved',
  'on_sale',
  'off_sale',
  'archived',
  'sold_out',
]);
export const orderStatusSchema = z.enum([
  'paid',
  'awaiting_shipment',
  'shipped',
  'completed',
  'cancel_requested',
  'cancelled',
  'refunding',
  'refunded',
  'failed',
]);

const positiveInteger = z.number().int().positive();

export const productFieldsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: shopProductTypeSchema,
  category: z.string().trim().min(1).max(60).nullable().optional(),
  summary: z.string().trim().max(240).nullable().optional(),
  description: z.string().trim().min(1).max(20_000),
  price: positiveInteger.max(10_000_000),
  stock: z.number().int().min(0).max(10_000_000).nullable().optional(),
  minQuantity: positiveInteger.max(100).default(1),
  maxQuantity: positiveInteger.max(100).default(1),
  virtualType: z.string().trim().max(60).nullable().optional(),
  fulfillmentData: z.record(z.unknown()).nullable().optional(),
  imageUrls: z.array(z.string().trim().min(1).max(500)).max(10).default([]),
});

export const productInputSchema = productFieldsSchema.superRefine((value, context) => {
  if (value.maxQuantity < value.minQuantity) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['maxQuantity'], message: '每单最大数量不能小于最小数量' });
  }
  if (value.type === 'physical' && value.stock == null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['stock'], message: '实物商品必须填写库存' });
  }
});

export const productPatchSchema = productFieldsSchema.partial().superRefine((value, context) => {
  if (value.minQuantity !== undefined && value.maxQuantity !== undefined && value.maxQuantity < value.minQuantity) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['maxQuantity'], message: '每单最大数量不能小于最小数量' });
  }
  if (value.type === 'physical' && value.stock == null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['stock'], message: '实物商品必须填写库存' });
  }
});

export const createShopOrderSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9:_-]+$/),
  addressId: z.string().regex(/^\d+$/).optional(),
  items: z.array(z.object({
    productId: z.string().regex(/^\d+$/),
    quantity: positiveInteger.max(100),
  })).min(1).max(50),
}).superRefine((value, context) => {
  const ids = value.items.map((item) => item.productId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: '同一商品只能出现一次' });
  }
});

export const shippingAddressInputSchema = z.object({
  recipientName: z.string().trim().min(2).max(50),
  phone: z.string().trim().regex(/^1\d{10}$/),
  province: z.string().trim().min(2).max(50),
  city: z.string().trim().min(2).max(50),
  district: z.string().trim().min(1).max(50),
  detail: z.string().trim().min(5).max(300),
  postalCode: z.string().trim().regex(/^\d{6}$/).nullable().optional(),
  isDefault: z.boolean().default(false),
});

export function publisherPermissionActive(
  grant: { startsAt: Date; expiresAt: Date | null; revokedAt: Date | null; roleEnabled: boolean },
  now = new Date(),
) {
  return grant.roleEnabled
    && grant.revokedAt === null
    && grant.startsAt <= now
    && (grant.expiresAt === null || grant.expiresAt > now);
}

const secretKeys = new Set(['codeHash', 'codeCiphertext', 'redeemCodeHash', 'passwordHash', 'refreshTokenHash']);

function serializeValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !secretKeys.has(key))
        .map(([key, nested]) => [key, serializeValue(nested)]),
    );
  }
  return value;
}

export function serializeShopProduct<T>(product: T) {
  return serializeValue(product) as T extends object ? Record<string, unknown> : T;
}

export function serializeShopOrder<T>(order: T) {
  return serializeValue(order) as T extends object ? Record<string, unknown> : T;
}

export function calculateShopOrderTotal(items: Array<{ price: number; quantity: number }>) {
  let total = 0;
  for (const item of items) {
    if (!Number.isSafeInteger(item.price) || item.price <= 0 || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new Error('INVALID_SHOP_AMOUNT');
    }
    const subtotal = item.price * item.quantity;
    if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(total + subtotal)) {
      throw new Error('INVALID_SHOP_AMOUNT');
    }
    total += subtotal;
  }
  return total;
}
