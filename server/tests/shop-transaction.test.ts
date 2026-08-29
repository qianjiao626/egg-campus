import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';

describe('shop checkout transaction', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  async function setup() {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'disabled';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    return app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
  }

  it('returns the existing order for a repeated idempotency key without opening a transaction', async () => {
    const token = await setup();
    vi.spyOn(prisma.shopOrder, 'findUnique').mockResolvedValue({ id: 8n, userId: 1n, idempotencyKey: 'checkout-repeat-001', status: 'completed', totalAmount: 20, items: [] } as never);
    const transaction = vi.spyOn(prisma, '$transaction');
    const response = await app!.inject({ method: 'POST', url: '/api/shop/orders', headers: { authorization: `Bearer ${token}` }, payload: { idempotencyKey: 'checkout-repeat-001', items: [{ productId: '9', quantity: 1 }] } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ duplicate: true, order: { id: '8' } });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects checkout when the point account cannot cover the total', async () => {
    const token = await setup();
    vi.spyOn(prisma.shopOrder, 'findUnique').mockResolvedValue(null);
    const queryRaw = vi.fn();
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      $queryRaw: queryRaw,
      shopOrder: { findUnique: vi.fn().mockResolvedValue(null) },
      shopProduct: { findMany: vi.fn().mockResolvedValue([{ id: 9n, name: '徽章', type: 'physical', price: 20, stock: 5, unlimitedStock: false, minQuantity: 1, maxQuantity: 2, status: 'on_sale' }]) },
      shippingAddress: { findFirst: vi.fn().mockResolvedValue({ id: 7n, userId: 1n, recipientName: '测试用户', phone: '13800000000', province: '江苏省', city: '南京市', district: '鼓楼区', detail: '测试路 1 号', postalCode: null }) },
      pointAccount: { findUnique: vi.fn().mockResolvedValue({ userId: 1n, availableBalance: 10, frozenBalance: 0 }) },
    }) as never);
    const response = await app!.inject({ method: 'POST', url: '/api/shop/orders', headers: { authorization: `Bearer ${token}` }, payload: { idempotencyKey: 'checkout-low-balance-001', addressId: '7', items: [{ productId: '9', quantity: 1 }] } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('SHOP_POINTS_INSUFFICIENT');
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('scopes order detail reads to the authenticated user', async () => {
    const token = await setup();
    const findFirst = vi.spyOn(prisma.shopOrder, 'findFirst').mockResolvedValue(null);
    const response = await app!.inject({ method: 'GET', url: '/api/shop/orders/99', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(404);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 99n, userId: 1n } }));
  });
});
