import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';

describe('team task multi-completion', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  function setup() {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
  }

  function arrange(counts: [number, number]) {
    setup();
    app = buildApp();
    return app.ready().then(async () => {
      vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
      const token = await app!.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
      const teamTask = { id: 40n, userId: 1n, taskType: 'team', reward: 0, maxClaimers: 3, status: 'approved', rewardFrozen: true, claimMode: 'first_come' };
      vi.spyOn(prisma.task, 'findUnique').mockResolvedValue(teamTask as never);
      vi.spyOn(prisma.taskClaim, 'findFirst').mockResolvedValue({ id: 300n, taskId: 40n, claimerId: 2n, status: 'submitted', frozenAmount: 0 } as never);
      const taskUpdate = vi.fn().mockImplementation(async (args: any) => ({ ...teamTask, ...args.data }));
      vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
        taskClaim: {
          findUnique: vi.fn().mockResolvedValue({ id: 300n, taskId: 40n, claimerId: 2n, status: 'submitted', frozenAmount: 0 }),
          update: vi.fn().mockResolvedValue({ id: 300n, taskId: 40n, claimerId: 2n, status: 'completed' }),
          count: vi.fn().mockResolvedValueOnce(counts[0]).mockResolvedValueOnce(counts[1]),
        },
        task: { findUnique: vi.fn().mockResolvedValue(teamTask), update: taskUpdate },
        userStats: { upsert: vi.fn().mockResolvedValue({}) },
        userCharacter: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn(), create: vi.fn().mockResolvedValue({}) },
        notification: { create: vi.fn().mockResolvedValue({}) },
      }) as never);
      return { token, taskUpdate };
    });
  }

  it('keeps the task approved after the first completion when active claimers remain', async () => {
    const { token, taskUpdate } = await arrange([1, 2]);
    const response = await app!.inject({ method: 'POST', url: '/api/tasks/40/complete', headers: { authorization: `Bearer ${token}` }, payload: { claimId: '300' } });
    expect(response.statusCode).toBe(200);
    expect(taskUpdate).toHaveBeenCalledWith({ where: { id: 40n }, data: {} });
  });

  it('closes the task after all team slots complete', async () => {
    const { token, taskUpdate } = await arrange([3, 0]);
    const response = await app!.inject({ method: 'POST', url: '/api/tasks/40/complete', headers: { authorization: `Bearer ${token}` }, payload: { claimId: '300' } });
    expect(response.statusCode).toBe(200);
    expect(taskUpdate).toHaveBeenCalledWith({ where: { id: 40n }, data: { status: 'completed', rewardFrozen: false, completedAt: expect.any(Date) } });
  });
});
