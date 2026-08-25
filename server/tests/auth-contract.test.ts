import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { hashPassword } from '../src/auth/password.js';

describe('password reset contract', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  it('returns the same success response for an unknown reset target', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(null);
    const create = vi.spyOn(prisma.verificationCode, 'create');

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset/request',
      payload: { channel: 'email', target: 'unknown@example.com' },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ ok: true, expiresInSeconds: 300, resendAfterSeconds: 60 });
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects malformed SMS targets before any provider call', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    app = buildApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/password-reset/request',
      payload: { channel: 'sms', target: '123' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('VALIDATION_ERROR');
  });

  it('sets an HttpOnly refresh cookie when cookie sessions are enabled', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    process.env.REFRESH_COOKIE_ENABLED = 'true';
    process.env.COOKIE_SECURE = 'false';
    app = buildApp();
    const passwordHash = await hashPassword('correct-password');
    const user = {
      id: 1n,
      nickname: 'cookie-user',
      email: 'cookie@example.com',
      phone: null,
      passwordHash,
      role: 'student',
      status: 'active',
      school: null,
      major: null,
      city: null,
      grade: null,
      age: null,
      bio: null,
      mbtiType: null,
      mbtiGroup: null,
      likes: 0,
      reputation: 0,
      eggCategory: 'study',
      eggRarity: 'N',
      inviteCode: 'COOKIE1',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLoginAt: null,
    };
    vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(user as never);
    vi.spyOn(prisma.user, 'update').mockResolvedValue(user as never);
    vi.spyOn(prisma.authSession, 'create').mockResolvedValue({} as never);
    vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as never);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: 'cookie@example.com', password: 'correct-password' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toContain('dandan_refresh=');
    expect(response.headers['set-cookie']).toContain('HttpOnly');
  });

  it('restores an administrator role from the persisted session after refresh', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    process.env.REFRESH_COOKIE_ENABLED = 'true';
    process.env.COOKIE_SECURE = 'false';
    process.env.COOKIE_PATH = '/api';
    app = buildApp();
    await app.ready();
    const session = { id: 'admin-session', userId: 7n, refreshTokenHash: 'unused', expiresAt: new Date(Date.now() + 60000), revokedAt: null };
    const admin = { id: 7n, role: 'admin' as const, status: 'active' as const };
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue(session as never);
    vi.spyOn(prisma.authSession, 'update').mockResolvedValue(session as never);
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(admin as never);
    vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as never);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: 'dandan_refresh=admin-refresh-token' },
    });

    expect(response.statusCode).toBe(200);
    expect((app.jwt.decode(response.json().accessToken) as { role?: string }).role).toBe('admin');
    expect(response.headers['set-cookie']).toContain('Path=/api');
  });
});
