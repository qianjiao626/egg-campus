import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';

describe('blacklist read performance contract', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  it('returns paged school comments while aggregating metrics in the database', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.blacklistSchool, 'findUnique').mockResolvedValue({ id: 9n, name: '清华大学', createdAt: new Date(), updatedAt: new Date() } as never);
    const count = vi.spyOn(prisma.blacklistComment, 'count').mockResolvedValue(25);
    const comments = vi.spyOn(prisma.blacklistComment, 'findMany').mockResolvedValue([] as never);
    const average = vi.spyOn(prisma.blacklistComment, 'aggregate').mockResolvedValue({ _avg: { averageScore: 7.2 } } as never);
    const metrics = vi.spyOn(prisma.blacklistScore, 'groupBy').mockResolvedValue([{ metricKey: 'canteen', _avg: { score: 8 } }] as never);

    const response = await app.inject({ method: 'GET', url: '/api/blacklist/school/9?page=2&pageSize=10' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ count: 25, total: 25, page: 2, pageSize: 10, avgScore: 7.2, metrics: { canteen: 8, manage: 0 } });
    expect(count).toHaveBeenCalledWith({ where: { schoolId: 9n, status: 'approved' } });
    expect(comments).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }));
    expect(average).toHaveBeenCalled();
    expect(metrics).toHaveBeenCalled();
  });
});
