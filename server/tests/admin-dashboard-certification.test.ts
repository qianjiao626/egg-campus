import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { PERMISSION_KEYS } from '../src/permissions.js';

describe('admin dashboard and certification contracts', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; vi.restoreAllMocks(); });
  async function setup(permissionKeys: string[], protectedAdminKey: string | null = null) {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp(); await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({ id: 1n, nickname: '管理员', role: protectedAdminKey ? 'admin' : 'student', status: 'active', protectedAdminKey, certifiedAt: null, mustChangePassword: false, interests: [], skills: [] } as never);
    vi.spyOn(prisma.userRoleGrant, 'findMany').mockResolvedValue(permissionKeys.length ? [{ startsAt: new Date(Date.now() - 60000), expiresAt: null, revokedAt: null, role: { enabled: true, permissions: permissionKeys.map((key) => ({ permission: { key } })) } }] as never : []);
    return app.jwt.sign({ sub: '1', sessionId: 'session', role: protectedAdminKey ? 'admin' : 'student' });
  }

  it('accepts an authenticated analytics event and persists it', async () => {
    const token = await setup([]);
    const create = vi.spyOn(prisma.analyticsEvent, 'create').mockResolvedValue({} as never);
    const response = await app!.inject({ method: 'POST', url: '/api/analytics/event', headers: { authorization: `Bearer ${token}` }, payload: { eventType: 'page_view', eventData: { page: 'plaza' }, page: 'plaza' } });
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ ok: true }); expect(create).toHaveBeenCalled();
  });

  it('allows a protected admin to certify and revoke a user', async () => {
    const token = await setup([PERMISSION_KEYS.userCertify], 'protected-admin');
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({ id: 2n } as never);
    vi.spyOn(prisma.user, 'update').mockResolvedValue({} as never);
    vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as never);
    const response = await app!.inject({ method: 'POST', url: '/api/admin/users/2/certify', headers: { authorization: `Bearer ${token}` }, payload: { certified: true } });
    expect(response.statusCode).toBe(200); expect(response.json().certified).toBe(true);
  });

  it('rejects certification by a non-protected administrator', async () => {
    const token = await setup([PERMISSION_KEYS.userCertify], null);
    const response = await app!.inject({ method: 'POST', url: '/api/admin/users/2/certify', headers: { authorization: `Bearer ${token}` }, payload: { certified: true } });
    expect(response.statusCode).toBe(403);
  });

  it('returns user detail with published and claimed task collections', async () => {
    const token = await setup([PERMISSION_KEYS.userList]);
    vi.spyOn(prisma.task, 'findMany').mockResolvedValue([] as never);
    vi.spyOn(prisma.taskClaim, 'findMany').mockResolvedValue([] as never);
    const response = await app!.inject({ method: 'GET', url: '/api/admin/users/1', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual(expect.objectContaining({ user: expect.any(Object), publishedTasks: [], claimedTasks: [] }));
  });

  it('returns all dashboard statistic series for an authorized admin', async () => {
    const token = await setup([PERMISSION_KEYS.userList]);
    vi.spyOn(prisma, '$queryRaw').mockResolvedValue([] as never);
    const response = await app!.inject({ method: 'GET', url: '/api/admin/dashboard/stats?startDate=2026-08-01&endDate=2026-08-31', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200); expect(response.json()).toEqual(expect.objectContaining({ registrations: [], pageViews: [], uniqueVisitors: [], homepageViews: [], dailyActiveUsers: [], navClicks: [], taskPublished: [], taskPublishedByType: [], taskClaimed: [], taskClaimedByType: [] }));
  });
});
