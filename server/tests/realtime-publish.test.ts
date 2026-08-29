import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { PERMISSION_KEYS } from '../src/permissions.js';

process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
process.env.VERIFICATION_PROVIDER = 'mock';

describe('REST realtime event publishing', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.restoreAllMocks();
  });

  async function authenticatedApp(userId = 1n) {
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({
      id: 'session', userId, revokedAt: null, expiresAt: new Date(Date.now() + 60_000),
    } as never);
    const token = await app.jwt.sign({ sub: userId.toString(), sessionId: 'session', role: 'student' });
    return { app, authorization: `Bearer ${token}` };
  }

  it('notifies current task reviewers after a task is committed', async () => {
    const context = await authenticatedApp();
    vi.spyOn(prisma.userStats, 'findUnique').mockResolvedValue({ userId: 1n, dailyPublishDate: null, dailyPublishCount: 0 } as never);
    vi.spyOn(prisma.userStats, 'update').mockResolvedValue({ userId: 1n } as never);
    vi.spyOn(prisma.task, 'create').mockResolvedValue({
      id: 41n, userId: 1n, title: '一起自习', description: '图书馆见', status: 'pending_review',
      publishExpReward: 10, createdAt: new Date(), updatedAt: new Date(),
    } as never);
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      $queryRaw: vi.fn(), userStats: prisma.userStats, task: prisma.task,
    }) as never);
    const publishAdmin = vi.spyOn(context.app.realtime, 'publishAdmin').mockResolvedValue();

    const response = await context.app.inject({
      method: 'POST', url: '/api/tasks', headers: { authorization: context.authorization },
      payload: { title: '一起自习', description: '图书馆见' },
    });

    expect(response.statusCode).toBe(201);
    expect(publishAdmin).toHaveBeenCalledWith(expect.objectContaining({
      type: 'task.pending', resourceId: '41', scope: 'admin', occurredAt: expect.any(String),
    }), PERMISSION_KEYS.taskReview);
  });

  it('notifies online users after an inquiry is committed', async () => {
    const context = await authenticatedApp();
    const inquiry = {
      id: 52n, userId: 1n, title: '食堂几点关门', content: '求告知', tags: [], bounty: 0,
      status: 'open', createdAt: new Date(), updatedAt: new Date(),
    };
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      inquiry: { create: vi.fn().mockResolvedValue(inquiry) },
    }) as never);
    const publishPublic = vi.spyOn(context.app.realtime, 'publishPublic');

    const response = await context.app.inject({
      method: 'POST', url: '/api/inquiries', headers: { authorization: context.authorization },
      payload: { title: '食堂几点关门', content: '求告知' },
    });

    expect(response.statusCode).toBe(201);
    expect(publishPublic).toHaveBeenCalledWith(expect.objectContaining({
      type: 'inquiry.created', resourceId: '52', scope: 'public', occurredAt: expect.any(String),
    }));
  });

  it('publishes private and ranking events after a point-changing buddy action', async () => {
    const context = await authenticatedApp();
    vi.spyOn(prisma.buddyFeatureRecord, 'findUnique').mockResolvedValue(null);
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      pointTransaction: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      pointAccount: {
        findUnique: vi.fn().mockResolvedValue({ userId: 1n, availableBalance: 10, frozenBalance: 0 }),
        update: vi.fn().mockResolvedValue({ userId: 1n, availableBalance: 9, frozenBalance: 0 }),
      },
      buddyFeatureRecord: {
        create: vi.fn().mockResolvedValue({
          id: 63n, userId: 1n, feature: 'box', action: 'draw', status: 'active', payload: {},
          result: { availablePrestige: 9 }, idempotencyKey: 'draw-63', createdAt: new Date(), updatedAt: new Date(),
        }),
      },
    }) as never);
    const publishPrivate = vi.spyOn(context.app.realtime, 'publishPrivate');
    const publishPublic = vi.spyOn(context.app.realtime, 'publishPublic');

    const response = await context.app.inject({
      method: 'POST', url: '/api/buddy-box/features', headers: { authorization: context.authorization },
      payload: { feature: 'box', action: 'draw', payload: {}, idempotencyKey: 'draw-63' },
    });

    expect(response.statusCode).toBe(201);
    expect(publishPrivate).toHaveBeenCalledWith([1n], expect.objectContaining({
      type: 'buddy.feature.updated', resourceId: '63', scope: 'private',
    }));
    expect(publishPublic).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ranking.updated', resourceId: '1', scope: 'public',
    }));
  });

});
