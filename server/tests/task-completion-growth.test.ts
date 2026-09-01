import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';

const now = new Date('2026-08-30T00:00:00.000Z');

describe('task completion growth rewards', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  it('unlocks the mapped character and increments the mapped stat once', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    vi.spyOn(prisma.task, 'findUnique')
      .mockResolvedValueOnce({ id: 10n, userId: 1n, taskType: 'help' } as never)
      .mockResolvedValueOnce({ id: 10n, userId: 1n, taskType: 'help', reward: 0, status: 'approved', completedAt: null } as never);
    vi.spyOn(prisma.taskClaim, 'findFirst').mockResolvedValue({ id: 20n, taskId: 10n, claimerId: 2n, status: 'submitted' } as never);
    const updateCharacter = vi.fn().mockResolvedValue({});
    const createCharacter = vi.fn().mockResolvedValue({ id: 30n, userId: 2n, category: 'job', count: 1, unlocked: true });
    const upsertStats = vi.fn().mockResolvedValue({});
    const transaction = vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      taskClaim: { findUnique: vi.fn().mockResolvedValue({ id: 20n, taskId: 10n, claimerId: 2n, status: 'submitted' }), update: vi.fn().mockResolvedValue({ id: 20n, taskId: 10n, claimerId: 2n, status: 'completed' }) },
      task: { findUnique: vi.fn().mockResolvedValue({ id: 10n, userId: 1n, taskType: 'help', reward: 0, status: 'approved', completedAt: null }), update: vi.fn().mockResolvedValue({ id: 10n, userId: 1n, taskType: 'help', reward: 0, status: 'completed', completedAt: now }) },
      userCharacter: { findFirst: vi.fn().mockResolvedValueOnce({ id: 30n, userId: 2n, category: 'job', unlocked: false }).mockResolvedValueOnce(null), update: updateCharacter, create: createCharacter },
      userStats: { upsert: upsertStats },
      notification: { create: vi.fn().mockResolvedValue({}) },
    }) as never);
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const response = await app.inject({ method: 'POST', url: '/api/tasks/10/complete', headers: { authorization: `Bearer ${token}` }, payload: { claimId: '20' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().unlockedCharacter).toBe('job');
    expect(updateCharacter).toHaveBeenCalledWith({ where: { id: 30n }, data: { count: { increment: 1 }, unlocked: true, unlockedAt: expect.any(Date) } });
    expect(upsertStats).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 2n }, update: { skills: { increment: 1 }, completedTasks: { increment: 1 }, experience: { increment: 5 } } }));
    expect(transaction).toHaveBeenCalledOnce();
  });

  it('creates missing stats and character rows for a legacy account', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    vi.spyOn(prisma.task, 'findUnique').mockResolvedValue({ id: 11n, userId: 1n, taskType: 'reward' } as never);
    vi.spyOn(prisma.taskClaim, 'findFirst').mockResolvedValue({ id: 21n, taskId: 11n, claimerId: 2n, status: 'submitted' } as never);
    const createCharacter = vi.fn().mockResolvedValue({});
    const upsertStats = vi.fn().mockResolvedValue({});
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      taskClaim: { findUnique: vi.fn().mockResolvedValue({ id: 21n, taskId: 11n, claimerId: 2n, status: 'submitted' }), update: vi.fn().mockResolvedValue({ id: 21n, taskId: 11n, claimerId: 2n, status: 'completed' }) },
      task: { findUnique: vi.fn().mockResolvedValue({ id: 11n, userId: 1n, taskType: 'reward', reward: 0, status: 'approved' }), update: vi.fn().mockResolvedValue({ id: 11n, userId: 1n, taskType: 'reward', reward: 0, status: 'completed' }) },
      userCharacter: { findFirst: vi.fn().mockResolvedValue(null), create: createCharacter, update: vi.fn() },
      userStats: { upsert: upsertStats },
      notification: { create: vi.fn().mockResolvedValue({}) },
    }) as never);
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const response = await app.inject({ method: 'POST', url: '/api/tasks/11/complete', headers: { authorization: `Bearer ${token}` }, payload: { claimId: '21' } });
    expect(response.statusCode).toBe(200);
    expect(createCharacter).toHaveBeenCalledTimes(2);
    expect(upsertStats).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 2n }, create: expect.objectContaining({ money: 1, completedTasks: 1, experience: 5 }) }));
  });

  it('does not update an already unlocked character', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    vi.spyOn(prisma.task, 'findUnique').mockResolvedValue({ id: 10n, userId: 1n, taskType: 'team', maxClaimers: 1 } as never);
    vi.spyOn(prisma.taskClaim, 'findFirst').mockResolvedValue({ id: 20n, taskId: 10n, claimerId: 2n, status: 'submitted' } as never);
    const updateCharacter = vi.fn();
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      taskClaim: { findUnique: vi.fn().mockResolvedValue({ id: 20n, taskId: 10n, claimerId: 2n, status: 'submitted' }), update: vi.fn().mockResolvedValue({ id: 20n, taskId: 10n, claimerId: 2n, status: 'completed' }), count: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0) },
      task: { findUnique: vi.fn().mockResolvedValue({ id: 10n, userId: 1n, taskType: 'team', reward: 0, status: 'approved' }), update: vi.fn().mockResolvedValue({ id: 10n, userId: 1n, taskType: 'team', reward: 0, status: 'completed' }) },
      userCharacter: { findFirst: vi.fn().mockResolvedValue({ id: 30n, userId: 2n, category: 'side', unlocked: true }), update: updateCharacter, create: vi.fn() },
      userStats: { upsert: vi.fn().mockResolvedValue({}) },
      notification: { create: vi.fn().mockResolvedValue({}) },
    }) as never);
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const response = await app.inject({ method: 'POST', url: '/api/tasks/10/complete', headers: { authorization: `Bearer ${token}` }, payload: { claimId: '20' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().unlockedCharacter).toBeNull();
    expect(updateCharacter).toHaveBeenCalledWith({ where: { id: 30n }, data: { count: { increment: 1 } } });
  });

  it('increments publisher stats and unlocks the publisher character too', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    vi.spyOn(prisma.task, 'findUnique').mockResolvedValue({ id: 10n, userId: 1n, taskType: 'teach' } as never);
    vi.spyOn(prisma.taskClaim, 'findFirst').mockResolvedValue({ id: 20n, taskId: 10n, claimerId: 2n, status: 'submitted' } as never);
    const updateCharacter = vi.fn().mockResolvedValue({});
    const upsertStats = vi.fn().mockResolvedValue({});
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      taskClaim: { findUnique: vi.fn().mockResolvedValue({ id: 20n, taskId: 10n, claimerId: 2n, status: 'submitted' }), update: vi.fn().mockResolvedValue({ id: 20n, taskId: 10n, claimerId: 2n, status: 'completed' }) },
      task: { findUnique: vi.fn().mockResolvedValue({ id: 10n, userId: 1n, taskType: 'teach', reward: 0, status: 'approved' }), update: vi.fn().mockResolvedValue({ id: 10n, userId: 1n, taskType: 'teach', reward: 0, status: 'completed' }) },
      userCharacter: { findFirst: vi.fn().mockResolvedValueOnce({ id: 30n, userId: 2n, category: 'study', unlocked: false }).mockResolvedValueOnce({ id: 31n, userId: 1n, category: 'study', unlocked: false }), update: updateCharacter, create: vi.fn() },
      userStats: { upsert: upsertStats },
      notification: { create: vi.fn().mockResolvedValue({}) },
    }) as never);
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const response = await app.inject({ method: 'POST', url: '/api/tasks/10/complete', headers: { authorization: `Bearer ${token}` }, payload: { claimId: '20' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().publisherUnlockedCharacter).toBe('study');
    expect(updateCharacter).toHaveBeenCalledWith({ where: { id: 31n }, data: { count: { increment: 1 }, unlocked: true, unlockedAt: expect.any(Date) } });
    expect(upsertStats).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 1n }, update: { knowledge: { increment: 1 } } }));
  });
});
