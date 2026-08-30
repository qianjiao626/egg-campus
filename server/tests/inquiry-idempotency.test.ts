import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

describe('inquiry bounty idempotency', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  it('returns the existing inquiry without charging again for a repeated key', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    vi.spyOn(prisma.inquiry, 'findFirst').mockResolvedValue({ id: 9n, userId: 1n, title: '重复请求', content: '内容', tags: [], bounty: 10, status: 'open', coinStatus: 'frozen', adopted: false, adoptedReplyId: null, deadline: null, createdAt: new Date(), updatedAt: new Date(), likes: 0 } as never);
    const transaction = vi.spyOn(prisma, '$transaction');
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/inquiries',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '重复请求', content: '内容', tags: [], bounty: 10, idempotencyKey: 'inquiry-idempotency-1' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().duplicate).toBe(true);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('returns the existing inquiry when concurrent creation loses the unique-key race', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    const existing = { id: 9n, userId: 1n, title: '竞态请求', content: '内容', tags: [], bounty: 10, status: 'open', coinStatus: 'frozen', adopted: false, adoptedReplyId: null, deadline: null, createdAt: new Date(), updatedAt: new Date(), likes: 0, idempotencyKey: 'inquiry:1:client:hash' };
    vi.spyOn(prisma.inquiry, 'findFirst')
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(existing as never);
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '6.19.0' }));
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/inquiries',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: '竞态请求', content: '内容', tags: [], bounty: 10, idempotencyKey: 'inquiry-idempotency-race' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ duplicate: true, inquiry: { id: '9' } });
  });
});
