import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';

describe('registration error contract', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  async function readyApp() {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
  }

  it('returns a readable parameter error without a stack trace', async () => {
    await readyApp();
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { nickname: 'a', password: 'short' } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'VALIDATION_ERROR', message: '请求参数不符合要求' });
    expect(JSON.stringify(response.json())).not.toMatch(/stack|node_modules|ZodError/i);
  });

  it('maps a registration database outage to a stable Chinese service error', async () => {
    await readyApp();
    const databaseError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3306'), { name: 'PrismaClientInitializationError' });
    vi.spyOn(prisma, '$transaction').mockRejectedValue(databaseError);
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { nickname: '数据库异常用户', password: 'correct-password' } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'DATABASE_UNAVAILABLE', message: '注册服务暂时不可用，请稍后重试' });
    expect(JSON.stringify(response.json())).not.toMatch(/ECONNREFUSED|3306|stack/i);
  });

  it('maps a structurally compatible Prisma duplicate error to a conflict', async () => {
    await readyApp();
    const duplicateError = Object.assign(new Error('unique constraint failed'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      meta: { target: ['nickname'] },
    });
    vi.spyOn(prisma, '$transaction').mockRejectedValue(duplicateError);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { nickname: '重复昵称用户', password: 'correct-password' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'DUPLICATE_USER', message: '昵称或邮箱已被使用' });
  });
});
