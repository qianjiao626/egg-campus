import { describe, expect, it, vi } from 'vitest';
import { offSalePublisherProductsIfUnauthorized, runShopMaintenance } from '../src/shop-maintenance.js';

describe('shop maintenance', () => {
  it('completes shipped orders once and does not duplicate notifications', async () => {
    const order = { id: 9n, userId: 4n };
    const db = {
      shopOrder: {
        findMany: vi.fn().mockResolvedValue([order]),
        updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }),
      },
      shopOrderItem: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      notification: { create: vi.fn().mockResolvedValue({}) },
      shopProduct: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
      userRoleGrant: { findMany: vi.fn() },
    };
    const now = new Date('2026-08-26T12:00:00.000Z');

    const first = await runShopMaintenance(db as never, now);
    const second = await runShopMaintenance(db as never, now);

    expect(first.completedOrders).toBe(1);
    expect(second.completedOrders).toBe(0);
    expect(db.notification.create).toHaveBeenCalledTimes(1);
    expect(db.shopOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 9n, status: 'shipped', completedAt: null },
      data: { status: 'completed', completedAt: now },
    });
  });

  it('keeps products online while any effective role still grants publishing', async () => {
    const db = {
      userRoleGrant: {
        findMany: vi.fn().mockResolvedValue([{ role: { permissions: [{ permission: { key: 'shop.product.create_own' } }] } }]),
      },
      shopProduct: { updateMany: vi.fn() },
      notification: { create: vi.fn() },
    };

    const count = await offSalePublisherProductsIfUnauthorized(db as never, 7n, new Date());

    expect(count).toBe(0);
    expect(db.shopProduct.updateMany).not.toHaveBeenCalled();
  });

  it('off-sales all live products when the publisher loses the final effective grant', async () => {
    const db = {
      userRoleGrant: { findMany: vi.fn().mockResolvedValue([]) },
      shopProduct: { updateMany: vi.fn().mockResolvedValue({ count: 3 }) },
      notification: { create: vi.fn().mockResolvedValue({}) },
    };
    const now = new Date('2026-08-26T12:00:00.000Z');

    const count = await offSalePublisherProductsIfUnauthorized(db as never, 7n, now);

    expect(count).toBe(3);
    expect(db.shopProduct.updateMany).toHaveBeenCalledWith({
      where: { publisherId: 7n, status: 'on_sale' },
      data: { status: 'off_sale' },
    });
    expect(db.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 7n, type: 'shop_publisher_permission_lost' }),
    });
  });

  it('checks multiple publishers in one authorization query', async () => {
    const grants = vi.fn().mockResolvedValue([
      { userId: 7n, role: { permissions: [{ permission: { key: 'shop.product.create_own' } }] } },
    ]);
    const db = {
      userRoleGrant: { findMany: grants },
      shopProduct: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      notification: { create: vi.fn().mockResolvedValue({}) },
    };

    const count = await offSalePublisherProductsIfUnauthorized(db as never, [7n, 8n], new Date());

    expect(count).toBe(2);
    expect(grants).toHaveBeenCalledTimes(1);
    expect(db.shopProduct.updateMany).toHaveBeenCalledWith({
      where: { publisherId: 8n, status: 'on_sale' },
      data: { status: 'off_sale' },
    });
    expect(db.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 8n, type: 'shop_publisher_permission_lost' }),
    });
  });

  it('does not block role revocation when the disabled shop table is absent', async () => {
    const missingTable = Object.assign(new Error('The table `shop_products` does not exist'), { code: 'P2021' });
    const db = {
      userRoleGrant: { findMany: vi.fn().mockResolvedValue([]) },
      shopProduct: { updateMany: vi.fn().mockRejectedValue(missingTable) },
      notification: { create: vi.fn() },
    };

    await expect(offSalePublisherProductsIfUnauthorized(db as never, 7n, new Date())).resolves.toBe(0);
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it('loads publisher permissions once for the maintenance batch', async () => {
    const grants = vi.fn().mockResolvedValue([{ userId: 7n, role: { permissions: [{ permission: { key: 'shop.product.create_own' } }] } }]);
    const db = {
      shopOrder: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
      shopOrderItem: { updateMany: vi.fn() },
      shopProduct: { findMany: vi.fn().mockResolvedValue([{ publisherId: 7n }, { publisherId: 8n }]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      userRoleGrant: { findMany: grants },
      notification: { create: vi.fn().mockResolvedValue({}) },
    };

    const result = await runShopMaintenance(db as never, new Date('2026-08-26T12:00:00.000Z'));

    expect(result.offSaleProducts).toBe(1);
    expect(grants).toHaveBeenCalledTimes(1);
    expect(grants).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: { in: [7n, 8n] } }) }));
  });
});
