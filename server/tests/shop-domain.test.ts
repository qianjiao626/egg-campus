import { describe, expect, it } from 'vitest';
import {
  calculateShopOrderTotal,
  createShopOrderSchema,
  productInputSchema,
  publisherPermissionActive,
  serializeShopOrder,
  serializeShopProduct,
} from '../src/shop.js';

describe('shop domain rules', () => {
  it('accepts only positive integer prices, stock and quantities', () => {
    const baseProduct = {
      name: '校园纪念徽章',
      type: 'physical',
      description: '一枚校园纪念徽章',
      price: 20,
      stock: 10,
      minQuantity: 1,
      maxQuantity: 2,
    };

    expect(productInputSchema.safeParse(baseProduct).success).toBe(true);
    expect(productInputSchema.safeParse({ ...baseProduct, price: 0 }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...baseProduct, stock: -1 }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...baseProduct, maxQuantity: 0 }).success).toBe(false);
  });

  it('requires a bounded idempotency key and unique products at checkout', () => {
    expect(createShopOrderSchema.safeParse({
      idempotencyKey: 'checkout-20260826-001',
      items: [{ productId: '1', quantity: 1 }, { productId: '1', quantity: 2 }],
    }).success).toBe(false);
    expect(createShopOrderSchema.safeParse({
      idempotencyKey: 'checkout-20260826-002',
      items: [{ productId: '1', quantity: 1 }, { productId: '2', quantity: 2 }],
    }).success).toBe(true);
  });

  it('treats a permission as active only inside its grant window', () => {
    const now = new Date('2026-08-26T12:00:00.000Z');
    expect(publisherPermissionActive({ startsAt: new Date('2026-08-26T11:00:00.000Z'), expiresAt: null, revokedAt: null, roleEnabled: true }, now)).toBe(true);
    expect(publisherPermissionActive({ startsAt: new Date('2026-08-26T13:00:00.000Z'), expiresAt: null, revokedAt: null, roleEnabled: true }, now)).toBe(false);
    expect(publisherPermissionActive({ startsAt: new Date('2026-08-26T11:00:00.000Z'), expiresAt: new Date('2026-08-26T12:00:00.000Z'), revokedAt: null, roleEnabled: true }, now)).toBe(false);
    expect(publisherPermissionActive({ startsAt: new Date('2026-08-26T11:00:00.000Z'), expiresAt: null, revokedAt: now, roleEnabled: true }, now)).toBe(false);
    expect(publisherPermissionActive({ startsAt: new Date('2026-08-26T11:00:00.000Z'), expiresAt: null, revokedAt: null, roleEnabled: false }, now)).toBe(false);
  });

  it('serializes identifiers without leaking redeem-code hashes', () => {
    const product = serializeShopProduct({
      id: 9n,
      publisherId: 3n,
      name: '电子资料包',
      status: 'on_sale',
      price: 30,
      redeemCodes: [{ id: 7n, codeHash: 'secret', codeMask: 'AB****12' }],
    });
    const order = serializeShopOrder({
      id: 12n,
      userId: 5n,
      items: [{ id: 13n, orderId: 12n, productId: 9n, redeemCodeHash: 'secret' }],
    });

    expect(product).toMatchObject({ id: '9', publisherId: '3' });
    expect(JSON.stringify(product)).not.toContain('secret');
    expect(order).toMatchObject({ id: '12', userId: '5', items: [{ id: '13', orderId: '12', productId: '9' }] });
    expect(JSON.stringify(order)).not.toContain('secret');
  });

  it('calculates the order total with integer arithmetic', () => {
    expect(calculateShopOrderTotal([{ price: 20, quantity: 2 }, { price: 15, quantity: 3 }])).toBe(85);
    expect(() => calculateShopOrderTotal([{ price: 20, quantity: 0 }])).toThrow('INVALID_SHOP_AMOUNT');
  });
});
