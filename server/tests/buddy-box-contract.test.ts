import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';

describe('buddy box API contract', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  it('stores preferences for the authenticated user', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    const preference = { userId: 1n, mbtiType: 'INTP', hobbies: ['玩游戏'], todayActions: ['一起自习'], province: '江苏省', city: '南京市', district: '鼓楼区' };
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    vi.spyOn(prisma.buddyPreference, 'upsert').mockResolvedValue(preference as never);
    const response = await app.inject({ method: 'PUT', url: '/api/buddy-box/preferences', headers: { authorization: 'Bearer ' + await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' }) }, payload: { mbtiType: 'INTP', hobbies: ['玩游戏'], todayActions: ['一起自习'], province: '江苏省', city: '南京市', district: '鼓楼区' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().preference.mbtiType).toBe('INTP');
  });

  it('rejects buddy messages without authentication', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    app = buildApp();
    const response = await app.inject({ method: 'POST', url: '/api/buddy-box/messages', payload: { recipientId: '2', text: '你好' } });
    expect(response.statusCode).toBe(401);
  });

  it('persists a user-owned advanced buddy feature action', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    vi.spyOn(prisma.buddyFeatureRecord, 'findUnique').mockResolvedValue(null);
    vi.spyOn(prisma.buddyFeatureRecord, 'create').mockResolvedValue({
      id: 1n,
      userId: 1n,
      feature: 'quiz',
      action: 'create',
      status: 'active',
      payload: { questions: ['你喜欢哪种音乐？'] },
      result: { accepted: true },
      idempotencyKey: 'feature-test-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    const response = await app.inject({
      method: 'POST',
      url: '/api/buddy-box/features',
      headers: { authorization: 'Bearer ' + await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' }) },
      payload: { feature: 'quiz', action: 'create', payload: { questions: ['你喜欢哪种音乐？'] }, idempotencyKey: 'feature-test-1' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().record.userId).toBe('1');
    expect(response.json().record.feature).toBe('quiz');
  });

  it('rejects advanced buddy feature actions without authentication', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    app = buildApp();
    const response = await app.inject({ method: 'POST', url: '/api/buddy-box/features', payload: { feature: 'quiz', action: 'create', payload: {} } });
    expect(response.statusCode).toBe(401);
  });

  it('charges one prestige for a draw in the same transaction as the record', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    vi.spyOn(prisma.buddyFeatureRecord, 'findUnique').mockResolvedValue(null);
    const update = vi.fn().mockResolvedValue({ userId: 1n, availableBalance: 9, frozenBalance: 0 });
    const tx = {
      pointTransaction: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      pointAccount: {
        findUnique: vi.fn().mockResolvedValue({ userId: 1n, availableBalance: 10, frozenBalance: 0 }),
        update,
      },
      buddyFeatureRecord: {
        create: vi.fn().mockResolvedValue({ id: 2n, userId: 1n, feature: 'box', action: 'draw', status: 'active', payload: {}, result: { availablePrestige: 9 }, idempotencyKey: 'draw-test', createdAt: new Date(), updatedAt: new Date() }),
      },
    };
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback(tx));
    const response = await app.inject({
      method: 'POST',
      url: '/api/buddy-box/features',
      headers: { authorization: 'Bearer ' + await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' }) },
      payload: { feature: 'box', action: 'draw', payload: { actionPool: ['一起自习'] }, idempotencyKey: 'draw-test' },
    });
    expect(response.statusCode).toBe(201);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ availableBalance: 9 }) }));
    expect(tx.pointTransaction.create).toHaveBeenCalledOnce();
  });

  it('restores the authenticated user feature records after reload', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    vi.spyOn(prisma.buddyFeatureRecord, 'findMany').mockResolvedValue([{
      id: 9n,
      userId: 1n,
      feature: 'board',
      action: 'publish',
      status: 'active',
      payload: { text: '今天一起自习吗？' },
      result: { accepted: true },
      idempotencyKey: 'board-test',
      createdAt: new Date(),
      updatedAt: new Date(),
      user: { nickname: '当前用户' },
    }] as never);
    const response = await app.inject({
      method: 'GET',
      url: '/api/buddy-box/features?scope=mine&limit=100',
      headers: { authorization: 'Bearer ' + await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' }) },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().records[0]).toEqual(expect.objectContaining({ feature: 'board', userId: '1' }));
  });
});
