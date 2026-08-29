import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { BLACKLIST_METRIC_KEYS } from '../src/blacklist.js';

const scores = Object.fromEntries(BLACKLIST_METRIC_KEYS.map((key) => [key, 8]));

describe('blacklist submit API', () => {
  let app: FastifyInstance;
  afterEach(async () => { await app?.close(); vi.restoreAllMocks(); });

  it('requires authentication and all sixteen integer scores', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp(); await app.ready();
    const guest = await app.inject({ method: 'POST', url: '/api/blacklist/submit', payload: { schoolName: '清华大学', scores } });
    expect(guest.statusCode).toBe(401);
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const missing = { ...scores }; delete missing.headcount;
    const response = await app.inject({ method: 'POST', url: '/api/blacklist/submit', headers: { authorization: `Bearer ${token}` }, payload: { schoolName: '清华大学', scores: missing } });
    expect(response.statusCode).toBe(400);
  });

  it('creates an immutable comment with sixteen scores and first reward', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp(); await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    const tx: any = {
      blacklistSchool: { findUnique: vi.fn().mockResolvedValue({ id: 9n, name: '清华大学' }), upsert: vi.fn().mockResolvedValue({ id: 9n, name: '清华大学' }) },
      blacklistComment: { findUnique: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({ id: 10n, userId: 1n, schoolId: 9n, content: '体验一般', averageScore: 8, createdAt: new Date(), user: { nickname: '海景蛋' }, scores: [] }) },
      pointTransaction: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      pointAccount: { findUnique: vi.fn().mockResolvedValue({ userId: 1n, availableBalance: 100, frozenBalance: 0 }), update: vi.fn().mockResolvedValue({ availableBalance: 110, frozenBalance: 0 }) },
      userStats: { upsert: vi.fn() },
    };
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback(tx) as never);
    vi.spyOn(prisma.blacklistComment, 'count').mockResolvedValue(1 as never);
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const response = await app.inject({ method: 'POST', url: '/api/blacklist/submit', headers: { authorization: `Bearer ${token}` }, payload: { schoolName: '清华大学', scores, comment: '体验一般' } });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(expect.objectContaining({ success: true, expGain: 10, coinGain: 10 }));
    expect(tx.blacklistComment.create).toHaveBeenCalled();
  });
});
