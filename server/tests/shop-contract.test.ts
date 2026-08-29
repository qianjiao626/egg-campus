import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';

describe('shop API contracts', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  function setup(userId = 1n) {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'disabled';
    app = buildApp();
    return app.ready().then(async () => {
      vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
      return app!.jwt.sign({ sub: userId.toString(), sessionId: 'session', role: 'student' });
    });
  }

  it('requires authentication for the catalog and cart', async () => {
    await setup();
    const catalog = await app!.inject({ method: 'GET', url: '/api/shop/products' });
    const cart = await app!.inject({ method: 'GET', url: '/api/shop/cart' });
    expect(catalog.statusCode).toBe(401);
    expect(cart.statusCode).toBe(401);
  });

  it('lists only on-sale products for regular users', async () => {
    const token = await setup();
    vi.spyOn(prisma.shopProduct, 'findMany').mockResolvedValue([{
      id: 9n,
      publisherId: 3n,
      publisherNickname: '发布者',
      name: '徽章',
      type: 'physical',
      category: null,
      summary: null,
      description: '校园徽章',
      price: 20,
      stock: 5,
      unlimitedStock: false,
      minQuantity: 1,
      maxQuantity: 2,
      virtualType: null,
      fulfillmentData: null,
      status: 'on_sale',
      reviewReason: null,
      reviewedBy: null,
      reviewedAt: null,
      publishedAt: new Date(),
      archivedAt: null,
      viewCount: 0,
      salesCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      images: [],
      _count: { reviews: 0 },
    }] as never);
    const response = await app!.inject({ method: 'GET', url: '/api/shop/products?sort=price_asc', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(prisma.shopProduct.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'on_sale' }) }));
    expect(response.json().products[0]).toMatchObject({ id: '9', price: 20, status: 'on_sale' });
  });

  it('scopes address deletion to the authenticated user', async () => {
    const token = await setup(2n);
    vi.spyOn(prisma.shippingAddress, 'findFirst').mockResolvedValue(null);
    const response = await app!.inject({ method: 'DELETE', url: '/api/shop/addresses/7', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(404);
    expect(prisma.shippingAddress.findFirst).toHaveBeenCalledWith({ where: { id: 7n, userId: 2n } });
  });

  it('prevents a regular user from creating publisher products', async () => {
    const token = await setup();
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({ protectedAdminKey: null, mustChangePassword: false } as never);
    vi.spyOn(prisma.userRoleGrant, 'findMany').mockResolvedValue([] as never);
    const response = await app!.inject({ method: 'POST', url: '/api/shop/publisher/products', headers: { authorization: `Bearer ${token}` }, payload: { name: '徽章', type: 'physical', description: '校园徽章', price: 20, stock: 2 } });
    expect(response.statusCode).toBe(403);
  });
});
