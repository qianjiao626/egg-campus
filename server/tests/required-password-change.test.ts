import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { prisma } from '../src/prisma.js';

describe('required password change', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.restoreAllMocks();
  });

  it('blocks normal APIs and revokes other sessions after changing the temporary password', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    const temporaryHash = await hashPassword('temporary-password');
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60_000) } as never);
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({ passwordHash: temporaryHash, mustChangePassword: true, role: 'admin' } as never);
    const userUpdate = vi.spyOn(prisma.user, 'update').mockResolvedValue({ id: 1n } as never);
    const sessionUpdate = vi.spyOn(prisma.authSession, 'updateMany').mockResolvedValue({ count: 2 });
    vi.spyOn(prisma, '$transaction').mockResolvedValue([] as never);
    vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({ id: 1n } as never);
    const gatedToken = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'admin', mustChangePassword: true });

    const blocked = await app.inject({ method: 'GET', url: '/api/users/me', headers: { authorization: `Bearer ${gatedToken}` } });
    const changed = await app.inject({
      method: 'POST',
      url: '/api/auth/change-required-password',
      headers: { authorization: `Bearer ${gatedToken}` },
      payload: { currentPassword: 'temporary-password', newPassword: 'a-new-password' },
    });

    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ ok: true });
    expect(changed.json().accessToken).toEqual(expect.any(String));
    expect(userUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ mustChangePassword: false }) }));
    expect(sessionUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { not: 'session' } }) }));
  }, 20000);
});
