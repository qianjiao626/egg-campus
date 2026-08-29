import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { PERMISSION_KEYS } from '../src/permissions.js';

const now = new Date('2026-08-27T00:00:00.000Z');

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 10n,
    userId: 1n,
    title: '一起学习 TypeScript',
    description: '每晚复盘一小时',
    remark: null,
    taskType: 'team',
    claimMode: 'multiple',
    reward: 20,
    publishExpReward: 10,
    maxClaimers: 3,
    contact: null,
    requirements: null,
    skillCategory: '学业技术',
    skillSubcategory: '编程开发',
    status: 'approved',
    reviewReason: null,
    createdAt: now,
    updatedAt: now,
    reviewedAt: now,
    completedAt: null,
    _count: { claims: 2 },
    claims: [{ status: 'assigned' }],
    ...overrides,
  };
}

describe('task persistence API contract', () => {
  let app: FastifyInstance;

  async function authenticatedApp(userId = 2n) {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    return app.jwt.sign({ sub: userId.toString(), sessionId: 'session', role: 'student' });
  }

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  it('returns only approved tasks with persisted claim aggregates', async () => {
    const token = await authenticatedApp();
    const findMany = vi.spyOn(prisma.task, 'findMany').mockResolvedValue([task()] as never);

    const response = await app.inject({ method: 'GET', url: '/api/tasks', headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(200);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'approved' } }));
    expect(response.json().tasks[0]).toMatchObject({
      id: '10',
      skillCategory: '学业技术',
      skillSubcategory: '编程开发',
      activeClaimCount: 2,
      claimStatus: 'assigned',
    });
    expect(response.json().tasks[0]).not.toHaveProperty('claims');
  });

  it('returns the real publisher identity with public tasks without exposing the raw user relation', async () => {
    const token = await authenticatedApp();
    const findMany = vi.spyOn(prisma.task, 'findMany').mockResolvedValue([task({
      user: { id: 1n, nickname: '真实发布者', eggCategory: 'study', eggRarity: 'SR' },
    })] as never);

    const response = await app.inject({ method: 'GET', url: '/api/tasks', headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(200);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({ user: { select: { id: true, nickname: true, eggCategory: true, eggRarity: true } } }),
    }));
    expect(response.json().tasks[0]).toMatchObject({
      publisher: { id: '1', nickname: '真实发布者', eggCategory: 'study', eggRarity: 'SR' },
    });
    expect(response.json().tasks[0].publisher).not.toHaveProperty('email');
    expect(response.json().tasks[0].publisher).not.toHaveProperty('phone');
    expect(response.json().tasks[0]).not.toHaveProperty('user');
  });

  it('allows a current RBAC reviewer to read the complete review queue', async () => {
    const token = await authenticatedApp(7n);
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({ protectedAdminKey: null, mustChangePassword: false } as never);
    vi.spyOn(prisma.userRoleGrant, 'findMany').mockResolvedValue([{
      startsAt: new Date(Date.now() - 1000), expiresAt: null, revokedAt: null,
      role: { enabled: true, permissions: [{ permission: { key: PERMISSION_KEYS.taskReview } }] },
    }] as never);
    const findMany = vi.spyOn(prisma.task, 'findMany').mockResolvedValue([task({ status: 'pending_review', _count: { claims: 0 }, claims: [] })] as never);

    const response = await app.inject({ method: 'GET', url: '/api/admin/tasks/review-queue', headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(200);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { in: ['pending_review', 'needs_revision', 'rejected'] } },
    }));
  });

  it('persists task skill category and subcategory on create', async () => {
    const token = await authenticatedApp(1n);
    const create = vi.fn().mockResolvedValue(task({ status: 'pending_review', _count: undefined, claims: undefined }));
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      $queryRaw: vi.fn(),
      userStats: {
        findUnique: vi.fn().mockResolvedValue({ userId: 1n, dailyPublishDate: now, dailyPublishCount: 0 }),
        update: vi.fn().mockResolvedValue({}),
      },
      task: { create },
    }) as never);

    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: '一起学习 TypeScript', description: '每晚复盘一小时', taskType: 'team', claimMode: 'multiple', maxClaimers: 3,
        skillCategory: '学业技术', skillSubcategory: '编程开发',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ skillCategory: '学业技术', skillSubcategory: '编程开发' }) }));
  });

  it('persists edited skills and resubmits a needs-revision task', async () => {
    const token = await authenticatedApp(1n);
    vi.spyOn(prisma.task, 'findUnique').mockResolvedValue(task({ status: 'needs_revision', _count: undefined, claims: undefined }) as never);
    const update = vi.spyOn(prisma.task, 'update').mockResolvedValue(task({
      status: 'pending_review', skillCategory: '就业技能', skillSubcategory: '前端开发', _count: undefined, claims: undefined,
    }) as never);

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/tasks/10',
      headers: { authorization: `Bearer ${token}` },
      payload: { skillCategory: '就业技能', skillSubcategory: '前端开发' },
    });

    expect(response.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 10n },
      data: expect.objectContaining({ skillCategory: '就业技能', skillSubcategory: '前端开发', status: 'pending_review', reviewReason: null }),
    }));
    expect(response.json().task).toMatchObject({ status: 'pending_review', skillCategory: '就业技能', skillSubcategory: '前端开发' });
  });

  it('persists abandonment and returns the real active claim count', async () => {
    const token = await authenticatedApp(2n);
    vi.spyOn(prisma.taskClaim, 'findUnique').mockResolvedValue({ id: 20n, taskId: 10n, claimerId: 2n, status: 'assigned', frozenAmount: 0 } as never);
    const update = vi.fn().mockResolvedValue({ id: 20n, taskId: 10n, claimerId: 2n, status: 'abandoned', frozenAmount: 0, createdAt: now, updatedAt: now });
    const count = vi.fn().mockResolvedValue(1);
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      taskClaim: { findUnique: prisma.taskClaim.findUnique, update },
      pointTransaction: prisma.pointTransaction,
      pointAccount: prisma.pointAccount,
    }) as never);
    vi.spyOn(prisma.taskClaim, 'count').mockImplementation(count as never);

    const response = await app.inject({ method: 'POST', url: '/api/tasks/10/abandon', headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'abandoned' } }));
    expect(response.json()).toMatchObject({ claim: { status: 'abandoned' }, activeClaimCount: 1 });
  });

  it('returns the real claimer egg profile to an authorized task owner', async () => {
    const token = await authenticatedApp(1n);
    vi.spyOn(prisma.task, 'findUnique').mockResolvedValue({ userId: 1n } as never);
    const findMany = vi.spyOn(prisma.taskClaim, 'findMany').mockResolvedValue([{
      id: 20n,
      taskId: 10n,
      claimerId: 2n,
      status: 'assigned',
      frozenAmount: 0,
      createdAt: now,
      updatedAt: now,
      claimer: {
        id: 2n,
        nickname: '真实认领者',
        mbtiType: 'INTP',
        reputation: 4.5,
        bio: null,
        eggCategory: 'study',
        eggRarity: 'SR',
      },
    }] as never);

    const response = await app.inject({ method: 'GET', url: '/api/tasks/10/claims', headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(200);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: { claimer: { select: expect.objectContaining({ eggCategory: true, eggRarity: true }) } },
    }));
    expect(response.json().claims[0].claimer).toMatchObject({
      id: '2', nickname: '真实认领者', eggCategory: 'study', eggRarity: 'SR',
    });
  });

  it('persists a teaching-task cancellation request for the matched participant', async () => {
    const token = await authenticatedApp(2n);
    vi.spyOn(prisma.task, 'findUnique').mockResolvedValue(task({ taskType: 'teach', userId: 1n, createdAt: new Date() }) as never);
    vi.spyOn(prisma.taskClaim, 'findMany').mockResolvedValue([{ id: 20n, taskId: 10n, claimerId: 2n, frozenAmount: 30, status: 'assigned' }] as never);
    vi.spyOn(prisma.taskCancellationRequest, 'findFirst').mockResolvedValue(null as never);
    const create = vi.fn().mockResolvedValue({ id: 30n, taskId: 10n, requesterId: 2n, recipientId: 1n, reason: '时间安排冲突', status: 'pending', createdAt: now, updatedAt: now });
    const notify = vi.fn().mockResolvedValue({});
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({ taskCancellationRequest: { create }, notification: { create: notify } }) as never);

    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks/10/cancellation-requests',
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: '时间安排冲突' },
    });

    expect(response.statusCode).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ taskId: 10n, requesterId: 2n, recipientId: 1n }) }));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 1n, type: 'task_cancellation_requested' }) }));
    expect(response.json().request).toMatchObject({ id: '30', taskId: '10', requesterId: '2', recipientId: '1', status: 'pending' });
  });
});
