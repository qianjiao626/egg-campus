import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';

describe('business API contracts', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  it('creates a pending task and scopes mine results to the authenticated user', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    vi.spyOn(prisma.task, 'create').mockResolvedValue({ id: 1n, userId: 1n, title: '找搭子', description: '一起自习', remark: null, status: 'pending_review', reviewReason: null, createdAt: new Date(), updatedAt: new Date(), reviewedAt: null, completedAt: null } as never);
    vi.spyOn(prisma.task, 'findMany').mockResolvedValue([{ id: 1n, userId: 1n, title: '找搭子', description: '一起自习', remark: null, status: 'pending_review', reviewReason: null, createdAt: new Date(), updatedAt: new Date(), reviewedAt: null, completedAt: null }] as never);
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const created = await app.inject({ method: 'POST', url: '/api/tasks', headers: { authorization: `Bearer ${token}` }, payload: { title: '找搭子', description: '一起自习' } });
    expect(created.statusCode).toBe(201);
    expect(created.json().task.status).toBe('pending_review');
    const listed = await app.inject({ method: 'GET', url: '/api/tasks/mine?status=pending_review', headers: { authorization: `Bearer ${token}` } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().tasks[0].userId).toBe('1');
  });

  it('rejects feedback containing blocked text before persistence', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    const create = vi.spyOn(prisma.feedback, 'create');
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const response = await app.inject({ method: 'POST', url: '/api/feedback', headers: { authorization: `Bearer ${token}` }, payload: { type: '页面问题', content: '请加微信' } });
    expect(response.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('returns reply summaries only for the authenticated users inquiries', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    vi.spyOn(prisma.inquiry, 'findMany').mockImplementation((async (args: any) => {
      if (!args.include?.replies) return [{ id: 8n, userId: 1n, title: '当前用户的打听', content: '请问图书馆开放时间', tags: ['校园'], bounty: 0, adoptedReplyId: null, deadline: null, createdAt: new Date(), user: { id: 1n, nickname: '当前用户' } }] as never;
      return [{
        id: 8n,
        userId: 1n,
        title: '当前用户的打听',
        content: '请问图书馆开放时间',
        tags: ['校园'],
        bounty: 0,
        adoptedReplyId: null,
        deadline: null,
        createdAt: new Date(),
        user: { id: 1n, nickname: '当前用户' },
        _count: { replies: 2 },
        replies: [{ id: 18n, inquiryId: 8n, userId: 2n, content: '晚上十点闭馆', kind: 'answer', parentId: null, createdAt: new Date(), user: { id: 2n, nickname: '回复者' } }],
      }] as never;
    }) as never);
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const response = await app.inject({ method: 'GET', url: '/api/inquiries/mine', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json().inquiries[0]).toEqual(expect.objectContaining({
      userId: '1',
      replyCount: 2,
      recentReplies: [expect.objectContaining({ id: '18', userId: '2', content: '晚上十点闭馆', user: { id: '2', nickname: '回复者' } })],
    }));
  });

  it('rejects a comment whose parent answer belongs to another inquiry', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 2n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    vi.spyOn(prisma.inquiry, 'findUnique').mockResolvedValue({ id: 8n, userId: 1n } as never);
    vi.spyOn(prisma.inquiryReply, 'findUnique').mockResolvedValue(null);
    const create = vi.spyOn(prisma.inquiryReply, 'create');
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback(prisma as never) as never);
    const token = await app.jwt.sign({ sub: '2', sessionId: 'session', role: 'student' });
    const response = await app.inject({ method: 'POST', url: '/api/inquiries/8/replies', headers: { authorization: `Bearer ${token}` }, payload: { content: '评论', kind: 'comment', parentId: '99' } });
    expect(response.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('persists an idempotent task claim and rejects a second claim by the same user', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 2n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    vi.spyOn(prisma.task, 'findUnique').mockResolvedValue({ id: 9n, userId: 1n, status: 'approved', taskType: 'help', reward: 10, maxClaimers: 1 } as never);
    const existingClaims = vi.spyOn(prisma.taskClaim, 'findUnique');
    existingClaims.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 11n, taskId: 9n, claimerId: 2n, status: 'pending' } as never);
    vi.spyOn(prisma.taskClaim, 'count').mockResolvedValue(0);
    vi.spyOn(prisma.taskClaim, 'create').mockResolvedValue({ id: 11n, taskId: 9n, claimerId: 2n, status: 'pending', createdAt: new Date(), updatedAt: new Date() } as never);
    vi.spyOn(prisma.notification, 'create').mockResolvedValue({ id: 101n, userId: 1n, type: 'task_claimed', refId: '9', payload: {}, readAt: null, createdAt: new Date() } as never);
    vi.spyOn(prisma.task, 'update').mockResolvedValue({ id: 9n, userId: 1n, status: 'approved' } as never);
    const token = await app.jwt.sign({ sub: '2', sessionId: 'session', role: 'student' });
    const first = await app.inject({ method: 'POST', url: '/api/tasks/9/claim', headers: { authorization: `Bearer ${token}` }, payload: { contact: 'student@example.com' } });
    const second = await app.inject({ method: 'POST', url: '/api/tasks/9/claim', headers: { authorization: `Bearer ${token}` }, payload: { contact: 'student@example.com' } });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('TASK_ALREADY_CLAIMED');
  });

  it('stores a task rating once and blocks duplicate ratings', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 2n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    vi.spyOn(prisma.task, 'findUnique').mockResolvedValue({ id: 9n, userId: 1n } as never);
    vi.spyOn(prisma.taskClaim, 'findFirst').mockResolvedValue({ id: 11n, taskId: 9n, claimerId: 2n, status: 'completed', task: { id: 9n, userId: 1n } } as never);
    const ratings = vi.spyOn(prisma.rating, 'findUnique');
    ratings.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 22n, taskId: 9n, fromUserId: 2n, toUserId: 1n, score: 5 } as never);
    vi.spyOn(prisma.rating, 'create').mockResolvedValue({ id: 22n, taskId: 9n, fromUserId: 2n, toUserId: 1n, score: 5, comment: null, createdAt: new Date() } as never);
    const token = await app.jwt.sign({ sub: '2', sessionId: 'session', role: 'student' });
    const first = await app.inject({ method: 'POST', url: '/api/tasks/9/rating', headers: { authorization: `Bearer ${token}` }, payload: { toUserId: '1', score: 5, comment: '配合很好' } });
    const second = await app.inject({ method: 'POST', url: '/api/tasks/9/rating', headers: { authorization: `Bearer ${token}` }, payload: { toUserId: '1', score: 5, comment: '配合很好' } });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('RATING_ALREADY_EXISTS');
  });
});
