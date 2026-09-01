import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';

const now = new Date('2026-08-30T00:00:00.000Z');

describe('task rating payer permissions', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  async function setup(taskType: string, userId: bigint) {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    vi.spyOn(prisma.task, 'findUnique').mockResolvedValue({ id: 10n, userId: 1n, taskType } as never);
    vi.spyOn(prisma.taskClaim, 'findFirst').mockResolvedValue({ claimerId: 2n } as never);
    vi.spyOn(prisma.rating, 'findUnique').mockResolvedValue(null);
    const created = { id: 1n, taskId: 10n, fromUserId: userId, toUserId: userId === 1n ? 2n : 1n, score: 5, comment: null, createdAt: now };
    vi.spyOn(prisma.rating, 'create').mockResolvedValue(created as never);
    const userUpdate = vi.fn().mockResolvedValue({});
    const statsUpsert = vi.fn().mockResolvedValue({});
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      rating: { create: vi.fn().mockResolvedValue(created), aggregate: vi.fn().mockResolvedValue({ _avg: { score: 5 } }) },
      user: { update: userUpdate },
      userStats: { upsert: statsUpsert },
    }) as never);
    return { token: await app.jwt.sign({ sub: userId.toString(), sessionId: 'session', role: 'student' }), userUpdate, statsUpsert };
  }

  it('allows only the claimer to rate a teach task', async () => {
    const { token: claimerToken } = await setup('teach', 2n);
    expect((await app!.inject({ method: 'POST', url: '/api/tasks/10/rating', headers: { authorization: `Bearer ${claimerToken}` }, payload: { toUserId: '1', score: 5 } })).statusCode).toBe(201);
    await app?.close();
    vi.restoreAllMocks();
    app = undefined;
    const { token: publisherToken } = await setup('teach', 1n);
    expect((await app!.inject({ method: 'POST', url: '/api/tasks/10/rating', headers: { authorization: `Bearer ${publisherToken}` }, payload: { toUserId: '2', score: 5 } })).statusCode).toBe(403);
  });

  it('allows only the publisher to rate help and reward tasks', async () => {
    for (const taskType of ['help', 'reward']) {
      const { token: publisherToken } = await setup(taskType, 1n);
      expect((await app!.inject({ method: 'POST', url: '/api/tasks/10/rating', headers: { authorization: `Bearer ${publisherToken}` }, payload: { toUserId: '2', score: 4 } })).statusCode).toBe(201);
      await (app as FastifyInstance | undefined)?.close();
      vi.restoreAllMocks();
      app = undefined;
      const { token: claimerToken } = await setup(taskType, 2n);
      expect((await app!.inject({ method: 'POST', url: '/api/tasks/10/rating', headers: { authorization: `Bearer ${claimerToken}` }, payload: { toUserId: '1', score: 4 } })).statusCode).toBe(403);
      await (app as FastifyInstance | undefined)?.close();
      vi.restoreAllMocks();
      app = undefined;
    }
  });

  it('allows both participants to rate team tasks', async () => {
    const { token: publisherToken } = await setup('team', 1n);
    expect((await app!.inject({ method: 'POST', url: '/api/tasks/10/rating', headers: { authorization: `Bearer ${publisherToken}` }, payload: { toUserId: '2', score: 5 } })).statusCode).toBe(201);
    await app?.close();
    vi.restoreAllMocks();
    app = undefined;
    const { token: claimerToken } = await setup('team', 2n);
    expect((await app!.inject({ method: 'POST', url: '/api/tasks/10/rating', headers: { authorization: `Bearer ${claimerToken}` }, payload: { toUserId: '1', score: 5 } })).statusCode).toBe(201);
  });

  it('synchronizes reputation to the user and stats rows in the rating transaction', async () => {
    const { token, userUpdate, statsUpsert } = await setup('teach', 2n);
    const response = await app!.inject({ method: 'POST', url: '/api/tasks/10/rating', headers: { authorization: `Bearer ${token}` }, payload: { toUserId: '1', score: 5 } });
    expect(response.statusCode).toBe(201);
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 1n }, data: { reputation: 5 } });
    expect(statsUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 1n }, update: { reputation: 5 } }));
  });

  it('synchronizes every newly rated team member in one batch transaction', async () => {
    const { token } = await setup('team', 1n);
    vi.spyOn(prisma.taskClaim, 'findMany').mockResolvedValue([{ claimerId: 2n }, { claimerId: 3n }] as never);
    const userUpdate = vi.fn().mockResolvedValue({});
    const statsUpsert = vi.fn().mockResolvedValue({});
    const txRatingFind = vi.fn().mockResolvedValue(null);
    const txRatingCreate = vi.fn().mockImplementation(async ({ data }: any) => ({ id: BigInt(String(data.toUserId)), ...data }));
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      rating: { findUnique: txRatingFind, create: txRatingCreate, aggregate: vi.fn().mockResolvedValue({ _avg: { score: 4 } }) },
      user: { update: userUpdate },
      userStats: { upsert: statsUpsert },
    }) as never);
    const response = await app!.inject({ method: 'POST', url: '/api/tasks/10/rating', headers: { authorization: `Bearer ${token}` }, payload: { ratings: [{ toUserId: '2', score: 4 }, { toUserId: '3', score: 5 }] } });
    expect(response.statusCode).toBe(200);
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 2n }, data: { reputation: 4 } });
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 3n }, data: { reputation: 4 } });
  });
});
