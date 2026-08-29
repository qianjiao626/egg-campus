import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { DAILY_TASK_PUBLISH_LIMIT, publishRewardForAttempt } from '../src/task-rules.js';

describe('business API contracts', () => {
  let app: FastifyInstance;

  it('defines the ten-attempt descending task reward schedule', () => {
    expect(DAILY_TASK_PUBLISH_LIMIT).toBe(10);
    expect(Array.from({ length: 10 }, (_, index) => publishRewardForAttempt(index + 1))).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(publishRewardForAttempt(11)).toBe(0);
  });

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
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({ $queryRaw: vi.fn(), userStats: { findUnique: vi.fn().mockResolvedValue({ userId: 1n, dailyPublishDate: new Date(), dailyPublishCount: 0 }), update: vi.fn().mockResolvedValue({}) }, task: prisma.task } as never) as never);
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

  it('publishes an inquiry and immediately returns it from the canonical mine route', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    const createdInquiry = {
      id: 88n,
      userId: 1n,
      title: '图书馆开放时间',
      content: '周末几点闭馆？',
      tags: ['校园'],
      bounty: 0,
      status: 'open',
      coinStatus: 'open',
      likes: 0,
      adopted: false,
      adoptedReplyId: null,
      deadline: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      inquiry: { create: vi.fn().mockResolvedValue(createdInquiry) },
    }) as never);
    vi.spyOn(prisma.inquiry, 'findMany').mockResolvedValue([{
      ...createdInquiry,
      user: { id: 1n, nickname: '当前用户' },
      _count: { replies: 0 },
      replies: [],
    }] as never);
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });

    const published = await app.inject({
      method: 'POST',
      url: '/api/inquiries',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: createdInquiry.title, content: createdInquiry.content, tags: createdInquiry.tags, bounty: 0 },
    });
    const mine = await app.inject({
      method: 'GET',
      url: '/api/inquiries/mine',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(published.statusCode).toBe(201);
    expect(published.json().inquiry.id).toBe('88');
    expect(mine.statusCode).toBe(200);
    expect(mine.json().inquiries[0]).toMatchObject({ id: '88', userId: '1', title: createdInquiry.title });
    expect(JSON.stringify(mine.json())).not.toMatch(/Route GET|Prisma|SQL/i);
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

  it('lists only task claims owned by the authenticated user', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 2n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    const findMany = vi.spyOn(prisma.taskClaim, 'findMany').mockResolvedValue([{
      id: 11n,
      taskId: 9n,
      claimerId: 2n,
      status: 'assigned',
      createdAt: new Date(),
      updatedAt: new Date(),
      task: { id: 9n, userId: 1n, title: '一起自习', description: '图书馆见', taskType: 'team', status: 'approved', reward: 10, createdAt: new Date(), updatedAt: new Date() },
    }] as never);
    vi.spyOn(prisma.rating, 'findMany').mockResolvedValue([{ taskId: 9n }] as never);
    const token = await app.jwt.sign({ sub: '2', sessionId: 'session', role: 'student' });
    const response = await app.inject({ method: 'GET', url: '/api/tasks/claimed', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { claimerId: 2n } }));
    expect(response.json().claims[0]).toMatchObject({ id: '11', claimerId: '2', ratedByCurrentUser: true, task: { id: '9', userId: '1', title: '一起自习' } });
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

  it('limits task publishing to ten attempts and exposes a descending reward', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    vi.spyOn(prisma.userStats, 'findUnique').mockResolvedValue({ userId: 1n, dailyPublishDate: new Date(), dailyPublishCount: 9, experience: 0 } as never);
    vi.spyOn(prisma.userStats, 'update').mockResolvedValue({ userId: 1n, dailyPublishDate: new Date(), dailyPublishCount: 10, experience: 0 } as never);
    vi.spyOn(prisma.task, 'create').mockResolvedValue({ id: 1n, userId: 1n, title: '找搭子', description: '一起自习', remark: null, status: 'pending_review', reviewReason: null, createdAt: new Date(), updatedAt: new Date(), reviewedAt: null, completedAt: null, publishExpReward: 1 } as never);
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({ $queryRaw: vi.fn(), userStats: prisma.userStats, task: prisma.task } as never) as never);
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const response = await app.inject({ method: 'POST', url: '/api/tasks', headers: { authorization: `Bearer ${token}` }, payload: { title: '找搭子', description: '一起自习' } });
    expect(response.statusCode).toBe(201);
    expect(response.json().task.publishExpReward).toBe(1);
  });

  it('serves a leaderboard from active registered users only', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.user, 'findMany').mockResolvedValue([{
      id: 7n, nickname: '真实用户', role: 'student', status: 'active', mbtiType: 'INTJ', mbtiGroup: 'NT', eggCategory: 'study', eggRarity: 'N', likes: 2, reputation: 4.5, createdAt: new Date(), updatedAt: new Date(), passwordHash: 'hash', email: null, phone: null, school: null, major: null, city: null, grade: null, age: null, bio: null, inviteCode: null, lastLoginAt: null, verifiedPhoneAt: null, verifiedEmailAt: null,
      stats: { experience: 12, knowledge: 1, skills: 2, charm: 3, money: 4, reputation: 4.5 }, account: { availableBalance: 123 },
    }] as never);
    const response = await app.inject({ method: 'GET', url: '/api/users/leaderboard?category=all' });
    expect(response.statusCode).toBe(200);
    expect(response.json().users).toEqual([expect.objectContaining({ id: '7', nickname: '真实用户', experience: 12 })]);
  });
});
