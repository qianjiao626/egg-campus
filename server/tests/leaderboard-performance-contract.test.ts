import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';

describe('leaderboard performance contract', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  it('limits normal leaderboard reads and selects only display fields', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    const users = vi.spyOn(prisma.user, 'findMany').mockResolvedValue([{
      id: 7n, nickname: '真实用户', mbtiType: 'INTJ', eggCategory: 'study', eggRarity: 'N', likes: 2, reputation: 4.5, createdAt: new Date(),
      stats: { experience: 12, knowledge: 1, skills: 2, charm: 3, money: 4, reputation: 4.5 }, account: { availableBalance: 123 },
    }] as never);

    const response = await app.inject({ method: 'GET', url: '/api/users/leaderboard?category=%E5%AD%A6%E4%B8%9A%E6%8A%80%E6%9C%AF&page=2&pageSize=10' });

    expect(response.statusCode).toBe(200);
    expect(response.json().users[0]).toMatchObject({ id: '7', rank: 11 });
    expect(users).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ eggCategory: 'study' }), skip: 10, take: 10, select: expect.objectContaining({ stats: expect.anything(), account: expect.anything() }) }));
  });

  it('aggregates gossip rankings in the database and returns one page', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    const query = vi.spyOn(prisma, '$queryRaw').mockResolvedValue([{
      id: 8n, nickname: '回答者', mbtiType: 'ENFP', eggCategory: 'hobby', eggRarity: 'R', likes: 4, reputation: 4.2, createdAt: new Date(), gossipLikes: 6n, answerCount: 3n, adoptedCount: 1n,
    }] as never);

    const response = await app.inject({ method: 'GET', url: '/api/users/leaderboard?category=gossip&page=2&pageSize=5' });

    expect(response.statusCode).toBe(200);
    expect(response.json().users[0]).toMatchObject({ id: '8', gossipLikes: 6, rank: 6 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toEqual(expect.objectContaining({ sql: expect.stringContaining('inquiry_reply_likes') }));
  });
});
