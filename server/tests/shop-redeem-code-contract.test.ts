import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { PERMISSION_KEYS } from '../src/permissions.js';
import { encryptRedeemCode } from '../src/redeem-code.js';

describe('shop redeem code API contract', () => {
  let app: FastifyInstance | undefined;
  const secret = 'a-dedicated-shop-redeem-secret-value';

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  async function setup(permissionKeys: string[] = []) {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.SHOP_REDEEM_CODE_SECRET = secret;
    process.env.VERIFICATION_PROVIDER = 'disabled';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60_000) } as never);
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({ id: 1n, protectedAdminKey: null, mustChangePassword: false } as never);
    vi.spyOn(prisma.userRoleGrant, 'findMany').mockResolvedValue(permissionKeys.length ? [{
      startsAt: new Date(Date.now() - 60_000), expiresAt: null, revokedAt: null,
      role: { enabled: true, permissions: permissionKeys.map((key) => ({ permission: { key } })) },
    }] as never : []);
    return app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
  }

  it('stores encrypted codes and never echoes plaintext from the admin import API', async () => {
    const token = await setup([PERMISSION_KEYS.shopRedeemCodeManage]);
    vi.spyOn(prisma.shopProduct, 'findUnique').mockResolvedValue({ id: 8n, type: 'virtual', virtualType: 'redeem_code' } as never);
    const createMany = vi.spyOn(prisma.productRedeemCode, 'createMany').mockResolvedValue({ count: 2 });
    vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as never);

    const response = await app!.inject({
      method: 'POST', url: '/api/admin/shop/products/8/redeem-codes',
      headers: { authorization: `Bearer ${token}` },
      payload: { codes: ['EGG-FIRST-SECRET', 'EGG-SECOND-SECRET'] },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ imported: 2 });
    expect(response.body).not.toContain('EGG-FIRST-SECRET');
    const data = createMany.mock.calls[0]?.[0]?.data;
    expect(Array.isArray(data)).toBe(true);
    const firstCode = Array.isArray(data) ? data[0] : data;
    expect(firstCode?.codeCiphertext).not.toContain('EGG-FIRST-SECRET');
    expect(firstCode).toMatchObject({ productId: 8n, codeMask: 'EGG-****-CRET' });
  });

  it('decrypts assigned codes only in the owning users entitlement response', async () => {
    const token = await setup();
    vi.spyOn(prisma.userEntitlement, 'findMany').mockResolvedValue([{
      id: 3n, userId: 1n, productId: 8n, orderItemId: 12n, type: 'redeem_code', payload: { redeemCodeIds: ['20'] }, status: 'active', acquiredAt: new Date(), expiresAt: null, usedAt: null,
      product: { name: '兑换权益' },
      orderItem: { id: 12n, redeemCodes: [{ id: 20n, codeMask: 'EGG-****-CRET', codeCiphertext: encryptRedeemCode('EGG-FIRST-SECRET', secret), status: 'assigned' }] },
    }] as never);

    const response = await app!.inject({ method: 'GET', url: '/api/shop/entitlements', headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(200);
    expect(response.json().entitlements[0].payload.codes).toEqual(['EGG-FIRST-SECRET']);
    expect(response.body).not.toContain('codeCiphertext');
  });

  it('adds encrypted storage to both Prisma schema and the production migration', () => {
    const schema = readFileSync(resolve(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
    const migration = readFileSync(resolve(process.cwd(), 'prisma', 'migrations', '202608260007_egg_mall', 'migration.sql'), 'utf8');
    expect(schema).toContain('codeCiphertext String');
    expect(migration).toContain('`code_ciphertext` TEXT NOT NULL');
  });

  it('keeps redeem-code checkout updates batched', () => {
    const source = readFileSync(resolve(process.cwd(), 'src', 'app.ts'), 'utf8');
    expect(source).toContain("productRedeemCode.updateMany({ where: { id: { in: codes.map((code) => code.id) }, status: 'available' }");
    expect(source).not.toContain('for (const code of codes)');
  });
});
