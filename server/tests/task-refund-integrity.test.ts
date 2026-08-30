import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';

const now = new Date('2026-08-30T00:00:00.000Z');

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 10n,
    userId: 1n,
    title: '悬赏任务',
    description: '测试任务',
    remark: null,
    taskType: 'reward',
    claimMode: 'single',
    reward: 100,
    publishExpReward: 0,
    maxClaimers: 1,
    contact: null,
    requirements: null,
    skillCategory: null,
    skillSubcategory: null,
    status: 'pending_review',
    reviewReason: null,
    createdAt: now,
    updatedAt: now,
    reviewedAt: null,
    completedAt: null,
    rewardFrozen: false,
    _count: { claims: 0 },
    claims: [],
    ...overrides,
  };
}

describe('task reward refund integrity', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  it('does not create a publisher refund for an unfrozen reward task', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();

    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({
      id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000),
    } as never);
    vi.spyOn(prisma.task, 'findUnique').mockResolvedValue(task() as never);
    vi.spyOn(prisma.taskClaim, 'findMany').mockResolvedValue([] as never);
    const pointTransactionCreate = vi.fn();
    const pointAccountUpdate = vi.fn();
    const taskClaimUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const taskUpdate = vi.fn().mockResolvedValue(task({ status: 'cancelled', rewardFrozen: false }));
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      taskClaim: { updateMany: taskClaimUpdateMany },
      task: { update: taskUpdate },
      pointTransaction: { findUnique: vi.fn(), create: pointTransactionCreate },
      pointAccount: { findUnique: vi.fn(), update: pointAccountUpdate },
    }) as never);

    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks/10/cancel',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(pointTransactionCreate).not.toHaveBeenCalled();
    expect(pointAccountUpdate).not.toHaveBeenCalled();
    expect(taskClaimUpdateMany).toHaveBeenCalledOnce();
    expect(taskUpdate).toHaveBeenCalledWith({
      where: { id: 10n },
      data: { status: 'cancelled', rewardFrozen: false },
    });
  });

  it('refunds a frozen reward task to its publisher on cancellation', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    vi.spyOn(prisma.task, 'findUnique').mockResolvedValue(task({ status: 'approved', rewardFrozen: true, taskType: 'reward', reward: 100 }) as never);
    vi.spyOn(prisma.taskClaim, 'findMany').mockResolvedValue([] as never);
    const pointTransactionCreate = vi.fn();
    const pointAccountUpdate = vi.fn().mockResolvedValue({ availableBalance: 100, frozenBalance: 0 });
    const taskUpdate = vi.fn().mockResolvedValue(task({ status: 'cancelled', rewardFrozen: false }));
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      taskClaim: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      task: { update: taskUpdate },
      pointTransaction: { findUnique: vi.fn().mockResolvedValue(null), create: pointTransactionCreate },
      pointAccount: { findUnique: vi.fn().mockResolvedValue({ userId: 1n, availableBalance: 0, frozenBalance: 0 }), update: pointAccountUpdate },
    }) as never);
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const response = await app.inject({ method: 'POST', url: '/api/tasks/10/cancel', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(pointAccountUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { availableBalance: 100, version: { increment: 1 } } }));
    expect(pointTransactionCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deltaAvailable: 100, type: 'task_reward_refund' }) }));
    expect(taskUpdate).toHaveBeenCalledWith({ where: { id: 10n }, data: { status: 'cancelled', rewardFrozen: false } });
  });

  it('refunds team rewards for every reserved slot', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    vi.spyOn(prisma.task, 'findUnique').mockResolvedValue(task({ status: 'approved', rewardFrozen: true, taskType: 'team', reward: 20, maxClaimers: 3 }) as never);
    vi.spyOn(prisma.taskClaim, 'findMany').mockResolvedValue([] as never);
    const pointTransactionCreate = vi.fn();
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      taskClaim: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      task: { update: vi.fn().mockResolvedValue(task({ status: 'cancelled', rewardFrozen: false })) },
      pointTransaction: { findUnique: vi.fn().mockResolvedValue(null), create: pointTransactionCreate },
      pointAccount: { findUnique: vi.fn().mockResolvedValue({ userId: 1n, availableBalance: 0, frozenBalance: 0 }), update: vi.fn().mockResolvedValue({ availableBalance: 60, frozenBalance: 0 }) },
    }) as never);
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const response = await app.inject({ method: 'POST', url: '/api/tasks/10/cancel', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(pointTransactionCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deltaAvailable: 60 }) }));
  });

  it('does not refund twice when a cancellation is repeated', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    vi.spyOn(prisma.task, 'findUnique')
      .mockResolvedValueOnce(task({ status: 'approved', rewardFrozen: true }) as never)
      .mockResolvedValueOnce(task({ status: 'cancelled', rewardFrozen: false }) as never);
    vi.spyOn(prisma.taskClaim, 'findMany').mockResolvedValue([] as never);
    const pointTransactionCreate = vi.fn();
    const transaction = vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      taskClaim: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      task: { update: vi.fn().mockResolvedValue(task({ status: 'cancelled', rewardFrozen: false })) },
      pointTransaction: { findUnique: vi.fn().mockResolvedValue(null), create: pointTransactionCreate },
      pointAccount: { findUnique: vi.fn().mockResolvedValue({ userId: 1n, availableBalance: 0, frozenBalance: 0 }), update: vi.fn().mockResolvedValue({ availableBalance: 100, frozenBalance: 0 }) },
    }) as never);
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const headers = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: 'POST', url: '/api/tasks/10/cancel', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/tasks/10/cancel', headers })).statusCode).toBe(409);
    expect(transaction).toHaveBeenCalledOnce();
    expect(pointTransactionCreate).toHaveBeenCalledOnce();
  });
});
