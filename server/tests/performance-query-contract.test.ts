import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp, refundExpiredInquiries } from '../src/app.js';
import { prisma } from '../src/prisma.js';

const setupEnvironment = () => {
  process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
  process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
  process.env.VERIFICATION_PROVIDER = 'mock';
};

describe('performance query contracts', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  it('uses a database aggregate for blacklist score statistics', async () => {
    setupEnvironment();
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.blacklistSchool, 'count').mockResolvedValue(12);
    vi.spyOn(prisma.blacklistComment, 'count').mockResolvedValue(30);
    vi.spyOn(prisma.blacklistScore, 'aggregate').mockResolvedValue({ _avg: { score: 6.25 } } as never);
    const scoreRows = vi.spyOn(prisma.blacklistScore, 'findMany');

    const response = await app.inject({ method: 'GET', url: '/api/blacklist/stats' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ schoolCount: 12, commentCount: 30, averageScore: 6.3, avgScore: 6.3 });
    expect(prisma.blacklistScore.aggregate).toHaveBeenCalledWith(expect.objectContaining({ _avg: { score: true } }));
    expect(scoreRows).not.toHaveBeenCalled();
  });

  it('groups search statistics in the database for the returned schools only', async () => {
    setupEnvironment();
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.blacklistSchool, 'findMany').mockResolvedValue([
      { id: 1n, name: 'Alpha University', createdAt: new Date(), updatedAt: new Date() },
      { id: 2n, name: 'Beta University', createdAt: new Date(), updatedAt: new Date() },
    ] as never);
    const groupBy = vi.spyOn(prisma.blacklistComment, 'groupBy').mockResolvedValue([
      { schoolId: 1n, _count: { _all: 2 }, _avg: { averageScore: 7.25 } },
    ] as never);
    const commentRows = vi.spyOn(prisma.blacklistComment, 'findMany');

    const response = await app.inject({ method: 'GET', url: '/api/blacklist/search?keyword=University' });

    expect(response.statusCode).toBe(200);
    expect(response.json().schools).toEqual(expect.arrayContaining([
      expect.objectContaining({ schoolId: '1', commentCount: 2, avgScore: 7.3 }),
      expect.objectContaining({ schoolId: '2', commentCount: 0, avgScore: 0 }),
    ]));
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ by: ['schoolId'], _count: { _all: true }, _avg: { averageScore: true } }));
    expect(commentRows).not.toHaveBeenCalled();
  });

  it('loads likes only for the page of inquiries being returned', async () => {
    setupEnvironment();
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60_000) } as never);
    vi.spyOn(prisma.inquiry, 'findMany').mockResolvedValue([
      { id: 9n, userId: 2n, title: 'Question', content: 'Content', tags: [], bounty: 0, status: 'open', coinStatus: 'open', likes: 0, adopted: false, adoptedReplyId: null, deadline: null, createdAt: new Date(), updatedAt: new Date(), user: { id: 2n, nickname: 'Other user' } },
    ] as never);
    const likes = vi.spyOn(prisma.inquiryLike, 'findMany').mockResolvedValue([{ inquiryId: 9n }] as never);
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });

    const response = await app.inject({ method: 'GET', url: '/api/inquiries?limit=1', headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(200);
    expect(response.json().inquiries[0]).toMatchObject({ id: '9', likedByMe: true });
    expect(likes).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 1n, inquiryId: { in: [9n] } } }));
  });

  it('limits each expired inquiry refund sweep to one batch', async () => {
    const findExpired = vi.spyOn(prisma.inquiry, 'findMany').mockResolvedValue([] as never);

    await expect(refundExpiredInquiries(new Date('2026-08-29T00:00:00.000Z'))).resolves.toEqual({ scanned: 0, refunded: 0 });

    expect(findExpired).toHaveBeenCalledWith(expect.objectContaining({ take: 100, orderBy: { deadline: 'asc' } }));
  });

  it('keeps each scheduled maintenance task non-overlapping while preserving error logging', () => {
    const source = readFileSync(resolve(process.cwd(), 'src', 'server.ts'), 'utf8');
    expect(source).toContain('function nonOverlappingSweep');
    expect(source.match(/setInterval\(nonOverlappingSweep/g)).toHaveLength(3);
    expect(source).toContain('verification cleanup failed');
    expect(source).toContain('inquiry refund sweep failed');
    expect(source).toContain('shop maintenance sweep failed');
  });
});
