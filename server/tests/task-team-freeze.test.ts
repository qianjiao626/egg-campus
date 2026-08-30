import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { PERMISSION_KEYS } from '../src/permissions.js';

describe('team task reward freeze', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  it('freezes reward multiplied by maxClaimers on first approval', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 9n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({ protectedAdminKey: null, mustChangePassword: false } as never);
    vi.spyOn(prisma.userRoleGrant, 'findMany').mockResolvedValue([{
      startsAt: new Date(Date.now() - 1000), expiresAt: null, revokedAt: null,
      role: { enabled: true, permissions: [{ permission: { key: PERMISSION_KEYS.taskReview } }] },
    }] as never);
    const task = { id: 10n, userId: 1n, taskType: 'team', reward: 20, maxClaimers: 3, status: 'pending_review', rewardFrozen: false, publishExpReward: 0 };
    vi.spyOn(prisma.task, 'findUnique').mockResolvedValue(task as never);
    const pointUpdate = vi.fn().mockResolvedValue({ availableBalance: 40, frozenBalance: 0 });
    const pointCreate = vi.fn().mockResolvedValue({});
    const taskUpdate = vi.fn().mockResolvedValue({ ...task, status: 'approved', rewardFrozen: true });
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      task: { findUnique: vi.fn().mockResolvedValue(task), update: taskUpdate },
      pointTransaction: { findUnique: vi.fn().mockResolvedValue(null), create: pointCreate },
      pointAccount: { findUnique: vi.fn().mockResolvedValue({ userId: 1n, availableBalance: 100, frozenBalance: 0 }), update: pointUpdate },
      invitation: { findUnique: vi.fn().mockResolvedValue(null), updateMany: vi.fn() },
      notification: { create: vi.fn().mockResolvedValue({}) },
    }) as never);
    const token = await app.jwt.sign({ sub: '9', sessionId: 'session', role: 'student' });
    const response = await app.inject({ method: 'PATCH', url: '/api/tasks/10/review', headers: { authorization: `Bearer ${token}` }, payload: { status: 'approved' } });
    expect(response.statusCode).toBe(200);
    expect(pointUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { availableBalance: 40, version: { increment: 1 } } }));
    expect(pointCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deltaAvailable: -60, type: 'task_reward_frozen' }) }));
    expect(taskUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ rewardFrozen: true }) }));
  });
});
