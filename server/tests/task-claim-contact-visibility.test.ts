import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';

describe('task claim contact visibility', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  it('keeps a new teaching claim pending until the publisher confirms pairing', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();

    const userId = 2n;
    const task = { id: 20n, userId: 1n, status: 'approved', taskType: 'teach', reward: 30, maxClaimers: 1 };
    const createdClaim = { id: 100n, taskId: 20n, claimerId: userId, contact: '手机123', frozenAmount: 30, status: 'pending' };
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    vi.spyOn(prisma.task, 'findUnique').mockResolvedValue(task as never);
    vi.spyOn(prisma.taskClaim, 'findUnique').mockResolvedValue(null);
    vi.spyOn(prisma.taskClaim, 'count').mockResolvedValue(0);
    const createClaim = vi.fn().mockResolvedValue(createdClaim);
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      taskClaim: { create: createClaim },
      pointTransaction: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      pointAccount: { findUnique: vi.fn().mockResolvedValue({ userId, availableBalance: 100, frozenBalance: 0, version: 1 }), update: vi.fn().mockResolvedValue({ userId, availableBalance: 70, frozenBalance: 0, version: 2 }) },
      notification: { create: vi.fn().mockResolvedValue({}) },
    }) as never);
    const token = await app.jwt.sign({ sub: userId.toString(), sessionId: 'session', role: 'student' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks/20/claim',
      headers: { authorization: `Bearer ${token}` },
      payload: { contact: '手机123' },
    });

    expect(response.statusCode).toBe(201);
    expect(createClaim).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'pending', contact: '手机123' }) }));
  });
});
