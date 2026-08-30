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
    vi.spyOn(prisma.rating, 'create').mockResolvedValue({ id: 1n, taskId: 10n, fromUserId: userId, toUserId: userId === 1n ? 2n : 1n, score: 5, comment: null, createdAt: now } as never);
    return app.jwt.sign({ sub: userId.toString(), sessionId: 'session', role: 'student' });
  }

  it('allows only the claimer to rate a teach task', async () => {
    const claimerToken = await setup('teach', 2n);
    expect((await app!.inject({ method: 'POST', url: '/api/tasks/10/rating', headers: { authorization: `Bearer ${claimerToken}` }, payload: { toUserId: '1', score: 5 } })).statusCode).toBe(201);
    await app?.close();
    vi.restoreAllMocks();
    app = undefined;
    const publisherToken = await setup('teach', 1n);
    expect((await app!.inject({ method: 'POST', url: '/api/tasks/10/rating', headers: { authorization: `Bearer ${publisherToken}` }, payload: { toUserId: '2', score: 5 } })).statusCode).toBe(403);
  });

  it('allows only the publisher to rate help and reward tasks', async () => {
    for (const taskType of ['help', 'reward']) {
      const publisherToken = await setup(taskType, 1n);
      expect((await app!.inject({ method: 'POST', url: '/api/tasks/10/rating', headers: { authorization: `Bearer ${publisherToken}` }, payload: { toUserId: '2', score: 4 } })).statusCode).toBe(201);
      await (app as FastifyInstance | undefined)?.close();
      vi.restoreAllMocks();
      app = undefined;
      const claimerToken = await setup(taskType, 2n);
      expect((await app!.inject({ method: 'POST', url: '/api/tasks/10/rating', headers: { authorization: `Bearer ${claimerToken}` }, payload: { toUserId: '1', score: 4 } })).statusCode).toBe(403);
      await (app as FastifyInstance | undefined)?.close();
      vi.restoreAllMocks();
      app = undefined;
    }
  });

  it('allows both participants to rate team tasks', async () => {
    const publisherToken = await setup('team', 1n);
    expect((await app!.inject({ method: 'POST', url: '/api/tasks/10/rating', headers: { authorization: `Bearer ${publisherToken}` }, payload: { toUserId: '2', score: 5 } })).statusCode).toBe(201);
    await app?.close();
    vi.restoreAllMocks();
    app = undefined;
    const claimerToken = await setup('team', 2n);
    expect((await app!.inject({ method: 'POST', url: '/api/tasks/10/rating', headers: { authorization: `Bearer ${claimerToken}` }, payload: { toUserId: '1', score: 5 } })).statusCode).toBe(201);
  });
});
