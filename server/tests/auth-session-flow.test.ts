import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const user = {
  id: 42n,
  nickname: '持久用户',
  email: 'persist@example.com',
  phone: null,
  passwordHash: 'unused-in-registration',
  role: 'student' as const,
  status: 'active',
  school: '南京大学',
  major: null,
  city: '南京市',
  grade: null,
  age: 20,
  bio: null,
  mbtiType: 'INTP',
  mbtiGroup: 'NT',
  likes: 0,
  reputation: 0,
  eggCategory: 'study',
  eggRarity: 'N',
  inviteCode: 'PERSIST42',
  createdAt: new Date('2026-08-24T00:00:00.000Z'),
  updatedAt: new Date('2026-08-24T00:00:00.000Z'),
  lastLoginAt: null,
};

describe('registration and cookie session flow', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  it('registers, restores /me with a rotated refresh cookie, then revokes logout', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    process.env.REFRESH_COOKIE_ENABLED = 'true';
    process.env.COOKIE_SECURE = 'false';
    process.env.COOKIE_PATH = '/api';
    app = buildApp();
    await app.ready();

    const tx = {
      user: { create: vi.fn().mockResolvedValue(user) },
      pointTransaction: { create: vi.fn().mockResolvedValue({}) },
    };
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback(tx));
    vi.spyOn(prisma.authSession, 'create').mockResolvedValue({} as never);
    vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as never);

    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        nickname: user.nickname,
        email: user.email,
        password: 'correct-password',
        school: user.school,
        major: '计算机科学',
        city: user.city,
        grade: '大二',
        age: user.age,
        mbtiType: user.mbtiType,
        mbtiGroup: user.mbtiGroup,
        eggCategory: user.eggCategory,
      },
    });

    expect(register.statusCode).toBe(201);
    expect(register.json().user.id).toBe('42');
    expect(register.headers['set-cookie']).toContain('dandan_refresh=');
    expect(register.headers['set-cookie']).toContain('Path=/api');
    expect(tx.user.create).toHaveBeenCalledOnce();
    expect(tx.pointTransaction.create).toHaveBeenCalledOnce();
    expect(tx).not.toHaveProperty('verificationCode');

    const cookie = String(register.headers['set-cookie']).split(';')[0];
    const session = { id: 'session-42', userId: 42n, revokedAt: null, expiresAt: new Date(Date.now() + 60_000) };
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue(session as never);
    vi.spyOn(prisma.authSession, 'update').mockResolvedValue(session as never);
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(user as never);
    vi.spyOn(prisma.userRoleGrant, 'findMany').mockResolvedValue([] as never);

    const refresh = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie } });
    expect(refresh.statusCode).toBe(200);
    expect(refresh.headers['set-cookie']).toContain('dandan_refresh=');
    const rotatedCookie = String(refresh.headers['set-cookie']).split(';')[0];
    expect(rotatedCookie).not.toBe(cookie);

    const me = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${refresh.json().accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(user.email);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${refresh.json().accessToken}`, cookie: rotatedCookie },
    });
    expect(logout.statusCode).toBe(200);
    expect(prisma.authSession.update).toHaveBeenCalled();

    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ ...session, revokedAt: new Date() } as never);
    const revoked = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: rotatedCookie } });
    expect(revoked.statusCode).toBe(401);
  });

  it('registers with only a nickname and self-set password when no contact is supplied', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    process.env.REFRESH_COOKIE_ENABLED = 'true';
    process.env.COOKIE_SECURE = 'false';
    process.env.COOKIE_PATH = '/api';
    app = buildApp();
    await app.ready();

    const nicknameUser = { ...user, id: 43n, nickname: '自主账号用户', email: null, phone: null };
    const tx = {
      user: { create: vi.fn().mockResolvedValue(nicknameUser) },
      pointTransaction: { create: vi.fn().mockResolvedValue({}) },
    };
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback(tx));
    vi.spyOn(prisma.authSession, 'create').mockResolvedValue({} as never);
    vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as never);

    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { nickname: nicknameUser.nickname, password: 'correct-password' },
    });

    expect(register.statusCode).toBe(201);
    expect(register.json().user.nickname).toBe(nicknameUser.nickname);
    expect(register.json().user.email).toBeNull();
    expect(register.headers['set-cookie']).toContain('dandan_refresh=');
    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: undefined, verifiedEmailAt: null, verifiedPhoneAt: null }),
    }));
    expect(tx.user.create.mock.calls[0]?.[0]?.data).not.toHaveProperty('phone');
    expect(tx.pointTransaction.create).toHaveBeenCalledOnce();
  });

  it('allows optional email contact without a registration code', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    process.env.REFRESH_COOKIE_ENABLED = 'true';
    process.env.COOKIE_SECURE = 'false';
    process.env.COOKIE_PATH = '/api';
    app = buildApp();
    await app.ready();

    const contactUser = { ...user, id: 44n, nickname: '可选联系方式用户', email: 'optional@example.com', phone: null };
    const tx = {
      user: { create: vi.fn().mockResolvedValue(contactUser) },
      pointTransaction: { create: vi.fn().mockResolvedValue({}) },
    };
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback(tx));
    vi.spyOn(prisma.authSession, 'create').mockResolvedValue({} as never);
    vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as never);

    const register = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { nickname: contactUser.nickname, email: contactUser.email, password: 'correct-password' },
    });

    expect(register.statusCode).toBe(201);
    expect(register.json().user.email).toBe(contactUser.email);
    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: contactUser.email, verifiedEmailAt: null, verifiedPhoneAt: null }),
    }));
    expect(tx.pointTransaction.create).toHaveBeenCalledOnce();
  });

  it('does not authenticate with a phone number', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();

    const phoneUser = { ...user, id: 45n, email: null, phone: '13800000000' };
    const findFirst = vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { identifier: phoneUser.phone, password: 'correct-password' },
    });

    expect(response.statusCode).toBe(401);
    expect(findFirst).toHaveBeenCalledOnce();
    expect(findFirst.mock.calls[0]?.[0]?.where?.OR).toEqual([
      { email: phoneUser.phone },
      { nickname: phoneUser.phone },
    ]);
  });

  it('does not consume email verification records during registration', () => {
    const source = readFileSync(resolve(process.cwd(), 'src', 'app.ts'), 'utf8');
    const start = source.indexOf("app.post('/api/auth/register'");
    const end = source.indexOf("app.post('/api/auth/login'", start);
    const registrationRoute = source.slice(start, end);

    expect(registrationRoute).not.toContain('registrationChannel');
    expect(registrationRoute).not.toContain('registrationTarget');
    expect(registrationRoute).not.toContain('VerificationTokenError');
    expect(registrationRoute).not.toContain('verificationCode');
    expect(registrationRoute).toContain('verifiedEmailAt: null');
  });

  it('keeps the public cookie path broad enough for buddy-box requests', () => {
    const nginx = readFileSync(resolve(process.cwd(), 'deploy', 'nginx-dsxnb-dd.conf'), 'utf8');
    expect(nginx).toContain('proxy_cookie_path /api /dd/api;');
    expect(nginx).not.toContain('proxy_cookie_path /api/auth /dd/api/auth;');
  });
});
