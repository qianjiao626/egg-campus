import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';

const session = {
  id: 'session',
  userId: 1n,
  revokedAt: null,
  expiresAt: new Date(Date.now() + 60_000),
};

describe('task invite flow', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.restoreAllMocks();
  });

  function buildInviteApp() {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    return app.ready();
  }

  it('persists an invite notification for the target user', async () => {
    await buildInviteApp();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue(session as never);
    const findUser = async (args: any) => {
      if (args.where.id === 1n) return { id: 1n, nickname: '发起者' };
      if (args.where.id === 2n) return { id: 2n };
      return null;
    };
    vi.spyOn(prisma.user, 'findUnique').mockImplementation(findUser as any);
    const create = vi.spyOn(prisma.notification, 'create').mockResolvedValue({ id: 99n } as never);

    const token = await app!.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const response = await app!.inject({
      method: 'POST',
      url: '/api/task-invites',
      headers: { authorization: `Bearer ${token}` },
      payload: { targetUserId: '2', skills: ['TypeScript', '设计'] },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ invited: true, notificationId: '99' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 2n,
        type: 'invite',
        payload: { from: '发起者', fromId: '1', skills: ['TypeScript', '设计'] },
      }),
    }));
  });

  it('rejects inviting yourself', async () => {
    await buildInviteApp();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue(session as never);

    const token = await app!.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const response = await app!.inject({
      method: 'POST',
      url: '/api/task-invites',
      headers: { authorization: `Bearer ${token}` },
      payload: { targetUserId: '1', skills: ['TypeScript'] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'INVITE_SELF' });
  });

  it('rejects more than seven skills', async () => {
    await buildInviteApp();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue(session as never);

    const token = await app!.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const response = await app!.inject({
      method: 'POST',
      url: '/api/task-invites',
      headers: { authorization: `Bearer ${token}` },
      payload: { targetUserId: '2', skills: ['1', '2', '3', '4', '5', '6', '7', '8'] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
  });
});
