import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  generateVerificationCode,
  hashVerificationValue,
  normalizeVerificationTarget,
  randomVerificationToken,
} from '../src/auth/verification.js';
import { MockVerificationProvider } from '../src/auth/provider.js';
import { InMemoryRateLimiter } from '../src/rate-limit.js';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';

describe('verification primitives', () => {
  it('generates a six digit numeric code', () => {
    const code = generateVerificationCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it('hashes values without returning the original value', () => {
    const value = '123456';
    const hash = hashVerificationValue(value);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(value);
    expect(hash).toBe(hashVerificationValue(value));
  });

  it('normalizes email targets', () => {
    expect(normalizeVerificationTarget('email', ' User@Example.COM ')).toBe('user@example.com');
  });

  it('creates an opaque single-use token', () => {
    const first = randomVerificationToken();
    const second = randomVerificationToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(first).not.toBe(second);
  });
});

describe('mock verification provider', () => {
  it('records delivery for tests without exposing it in an API response', async () => {
    const provider = new MockVerificationProvider();
    await provider.send({
      channel: 'email',
      target: 'user@example.com',
      code: '123456',
      purpose: 'register',
    });

    expect(provider.lastMessage()).toEqual({
      channel: 'email',
      target: 'user@example.com',
      code: '123456',
      purpose: 'register',
    });
  });
});

describe('verification rate limiter', () => {
  it('allows a bounded number of attempts and reports a retry time', () => {
    const limiter = new InMemoryRateLimiter();
    expect(limiter.check('target', 2, 60_000, 1000).allowed).toBe(true);
    expect(limiter.check('target', 2, 60_000, 1001).allowed).toBe(true);
    const blocked = limiter.check('target', 2, 60_000, 1002);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(limiter.check('target', 2, 60_000, 61_001).allowed).toBe(true);
  });
});

describe('verification API', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  it('stores only a hash and returns delivery metadata', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    vi.spyOn(prisma.verificationCode, 'findFirst').mockResolvedValue(null);
    const create = vi.spyOn(prisma.verificationCode, 'create').mockResolvedValue({ id: 'verification-1' } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/verification-codes',
      payload: { channel: 'email', target: 'user@example.com', purpose: 'register' },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ ok: true, expiresInSeconds: 300, resendAfterSeconds: 60 });
    expect(create).toHaveBeenCalledOnce();
    const data = create.mock.calls[0][0].data;
    expect(data.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(response.body).not.toContain(data.codeHash);
    expect(response.body).not.toMatch(/\d{6}/);
  });

  it('returns an opaque token after a correct code and increments wrong attempts', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    app = buildApp();
    const update = vi.spyOn(prisma.verificationCode, 'update').mockResolvedValue({} as never);
    vi.spyOn(prisma.verificationCode, 'findFirst').mockResolvedValue({
      id: 'verification-2',
      channel: 'email',
      target: 'user@example.com',
      purpose: 'register',
      codeHash: hashVerificationValue('123456'),
      verificationTokenHash: null,
      attempts: 0,
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 60_000),
      verifiedAt: null,
      consumedAt: null,
      requestIp: null,
      userAgent: null,
      createdAt: new Date(),
    } as never);

    const success = await app.inject({
      method: 'POST',
      url: '/api/auth/verification-codes/verify',
      payload: { channel: 'email', target: 'user@example.com', purpose: 'register', code: '123456' },
    });
    expect(success.statusCode).toBe(200);
    expect(success.json().verificationToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(update).toHaveBeenCalledOnce();

    vi.restoreAllMocks();
    const wrongUpdate = vi.spyOn(prisma.verificationCode, 'update').mockResolvedValue({} as never);
    vi.spyOn(prisma.verificationCode, 'findFirst').mockResolvedValue({
      id: 'verification-3',
      codeHash: hashVerificationValue('654321'),
      attempts: 0,
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    } as never);
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/verification-codes/verify',
      payload: { channel: 'email', target: 'user@example.com', purpose: 'register', code: '123456' },
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json()).toEqual({ error: 'INVALID_VERIFICATION_CODE', message: '验证码无效或已过期' });
    expect(wrongUpdate).toHaveBeenCalledOnce();
  });
});
