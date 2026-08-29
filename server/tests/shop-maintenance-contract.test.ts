import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { PERMISSION_KEYS } from '../src/permissions.js';
import { loadConfig } from '../src/config.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('shop maintenance API contract', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  async function setup(permissionKeys: string[]) {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
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

  it('requires the dedicated maintenance permission', async () => {
    const token = await setup([]);
    const response = await app!.inject({ method: 'POST', url: '/api/admin/shop/maintenance', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(403);
  });

  it('runs the idempotent sweep for an authorized administrator', async () => {
    const token = await setup([PERMISSION_KEYS.shopMaintenanceRun]);
    vi.spyOn(prisma.shopOrder, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.shopProduct, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as never);

    const response = await app!.inject({ method: 'POST', url: '/api/admin/shop/maintenance', headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ completedOrders: 0, offSaleProducts: 0 });
  });

  it('keeps scheduled shop maintenance disabled until the shop feature is explicitly enabled', () => {
    const config = loadConfig({
      DATABASE_URL: 'mysql://user:password@localhost:3306/dandan_world',
      JWT_SECRET: 'a-test-secret-that-is-longer-than-32-characters',
    });
    const source = readFileSync(resolve(process.cwd(), 'src', 'server.ts'), 'utf8');
    expect(config.SHOP_ENABLED).toBe(false);
    expect(source).toContain('if (config.SHOP_ENABLED)');
    expect(source).toContain('runShopMaintenance(prisma');
    expect(source).toContain('shop maintenance sweep failed');
    expect(source).toContain('clearInterval(shopMaintenanceSweep)');
  });
});
