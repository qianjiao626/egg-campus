import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { PERMISSION_KEYS } from '../src/permissions.js';

describe('RBAC API contract', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.restoreAllMocks();
  });

  async function setup(permissionKeys: string[]) {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60_000) } as never);
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
      id: 1n,
      nickname: '测试用户',
      role: 'student',
      status: 'active',
      protectedAdminKey: null,
      mustChangePassword: false,
      interests: [],
      skills: [],
    } as never);
    vi.spyOn(prisma.userRoleGrant, 'findMany').mockResolvedValue(permissionKeys.length ? [{
      startsAt: new Date(Date.now() - 60_000),
      expiresAt: null,
      revokedAt: null,
      role: { enabled: true, permissions: permissionKeys.map((key) => ({ permission: { key } })) },
    }] as never : []);
    vi.spyOn(prisma.feedback, 'findMany').mockResolvedValue([]);
  }

  it('does not trust an admin claim in the JWT without an effective grant', async () => {
    await setup([]);
    const token = await app!.jwt.sign({ sub: '1', sessionId: 'session', role: 'admin' });
    const response = await app!.inject({ method: 'GET', url: '/api/admin/feedback', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(403);
  });

  it('allows a student JWT when the database grants the exact permission', async () => {
    await setup([PERMISSION_KEYS.feedbackView]);
    const token = await app!.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const response = await app!.inject({ method: 'GET', url: '/api/admin/feedback', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ feedback: [] });
  });

  it('returns effective authorization instead of trusting the JWT role', async () => {
    await setup([]);
    const token = await app!.jwt.sign({ sub: '1', sessionId: 'session', role: 'admin' });
    const response = await app!.inject({ method: 'GET', url: '/api/users/me', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({
      permissionKeys: [],
      isAdministrator: false,
      isProtectedAdmin: false,
      mustChangePassword: false,
    });
  });

  it('reports administrator presentation when a student JWT has a management permission', async () => {
    await setup([PERMISSION_KEYS.feedbackView]);
    const token = await app!.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const response = await app!.inject({ method: 'GET', url: '/api/users/me', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({
      permissionKeys: [PERMISSION_KEYS.feedbackView],
      isAdministrator: true,
      isProtectedAdmin: false,
    });
  });

  it('returns server-backed profile, task, balance, and experience data for user management', async () => {
    await setup([PERMISSION_KEYS.userList]);
    vi.spyOn(prisma.user, 'findMany').mockResolvedValue([{
      id: 2n,
      nickname: '真实用户',
      email: 'real@example.com',
      status: 'active',
      school: '测试大学',
      major: '计算机',
      grade: '大二',
      protectedAdminKey: null,
      createdAt: new Date('2026-08-27T00:00:00.000Z'),
      account: { availableBalance: 135 },
      stats: { completedTasks: 4, experience: 28 },
      _count: { taskClaims: 2 },
    }] as never);
    const token = await app!.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });

    const response = await app!.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().users[0]).toEqual({
      id: '2',
      nickname: '真实用户',
      email: 'real@example.com',
      status: 'active',
      school: '测试大学',
      major: '计算机',
      grade: '大二',
      completedTasks: 4,
      inProgressTasks: 2,
      points: 135,
      experience: 28,
      protected: false,
      createdAt: '2026-08-27T00:00:00.000Z',
    });
  });

  it('renews an existing grant instead of creating a duplicate relationship', async () => {
    await setup([PERMISSION_KEYS.permissionRoleGrant]);
    vi.spyOn(prisma.role, 'findUnique').mockResolvedValue({ id: 5n, enabled: true, systemProtected: false } as never);
    const existing = { id: 9n, userId: 2n, roleId: 5n, startsAt: new Date('2026-08-01T00:00:00Z'), expiresAt: null, revokedAt: null };
    const update = vi.fn().mockImplementation(async ({ data }: any) => ({ ...existing, ...data, grantedBy: 1n }));
    const create = vi.fn();
    const audit = vi.fn().mockResolvedValue({});
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      userRoleGrant: { findFirst: vi.fn().mockResolvedValue(existing), update, create },
      roleGrantAudit: { create: audit },
    }) as never);
    const invalidatePermissions = vi.spyOn(app!.realtime, 'invalidatePermissions');
    const token = await app!.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const response = await app!.inject({ method: 'POST', url: '/api/admin/role-grants', headers: { authorization: `Bearer ${token}` }, payload: { userId: '2', roleId: '5', preset: '7d', reason: '续期' } });
    expect(response.statusCode).toBe(201);
    expect(update).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'renew' }) }));
    expect(invalidatePermissions).toHaveBeenCalledWith([2n]);
  });

  it('returns a stable 403 when changing a protected administrators grants', async () => {
    await setup([PERMISSION_KEYS.permissionRoleGrant]);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 2n, protectedAdminKey: 'protected', mustChangePassword: false } as never);
    vi.spyOn(prisma.role, 'findUnique').mockResolvedValue({ id: 5n, enabled: true, systemProtected: false } as never);
    const token = await app!.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const response = await app!.inject({ method: 'POST', url: '/api/admin/role-grants', headers: { authorization: `Bearer ${token}` }, payload: { userId: '2', roleId: '5', preset: '7d', reason: '测试' } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('PROTECTED_ADMIN');
  });

  it('rejects protected roles and custom durations shorter than one hour', async () => {
    await setup([PERMISSION_KEYS.permissionRoleGrant]);
    const role = vi.spyOn(prisma.role, 'findUnique').mockResolvedValue({ id: 5n, enabled: true, systemProtected: true } as never);
    const token = await app!.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const protectedRole = await app!.inject({ method: 'POST', url: '/api/admin/role-grants', headers: { authorization: `Bearer ${token}` }, payload: { userId: '2', roleId: '5', preset: '7d', reason: '测试' } });
    expect(protectedRole.statusCode).toBe(403);
    role.mockResolvedValue({ id: 5n, enabled: true, systemProtected: false } as never);
    const invalidDuration = await app!.inject({ method: 'POST', url: '/api/admin/role-grants', headers: { authorization: `Bearer ${token}` }, payload: { userId: '2', roleId: '5', preset: 'custom', customExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), reason: '测试' } });
    expect(invalidDuration.statusCode).toBe(400);
    expect(invalidDuration.json().error).toBe('INVALID_GRANT_DURATION');
  });

  it('returns serialized role grant audit entries to authorized administrators', async () => {
    await setup([PERMISSION_KEYS.permissionRoleGrant]);
    vi.spyOn(prisma.roleGrantAudit, 'findMany').mockResolvedValue([{
      id: 40n,
      grantId: 9n,
      actorId: 1n,
      action: 'grant',
      reason: '工作需要',
      beforeData: null,
      afterData: {},
      createdAt: new Date(),
      actor: { id: 1n, nickname: '管理员' },
      grant: { id: 9n, user: { id: 2n, nickname: '用户' }, role: { id: 5n, name: '反馈处理员' } },
    }] as never);
    const token = await app!.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const response = await app!.inject({ method: 'GET', url: '/api/admin/role-grant-audit', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json().audits[0]).toMatchObject({ id: '40', grantId: '9', actorId: '1', actor: { id: '1', nickname: '管理员' }, grant: { id: '9', user: { id: '2', nickname: '用户' }, role: { id: '5', name: '反馈处理员' } } });
  });

  it('off-sales publisher products immediately after the final publishing grant is revoked', async () => {
    await setup([PERMISSION_KEYS.permissionRoleRevoke]);
    vi.spyOn(prisma.userRoleGrant, 'findUnique').mockResolvedValue({
      id: 9n,
      userId: 2n,
      roleId: 5n,
      startsAt: new Date(),
      expiresAt: null,
      revokedAt: null,
      user: { protectedAdminKey: null },
      role: { systemProtected: false },
    } as never);
    vi.mocked(prisma.userRoleGrant.findMany).mockImplementation(((args: any) => {
      if (args?.where?.userId === 2n) return [] as never;
      return [{
        startsAt: new Date(Date.now() - 60_000),
        expiresAt: null,
        revokedAt: null,
        role: { enabled: true, permissions: [{ permission: { key: PERMISSION_KEYS.permissionRoleRevoke } }] },
      }] as never;
    }) as never);
    const offSale = vi.fn().mockResolvedValue({ count: 2 });
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      userRoleGrant: {
        update: vi.fn().mockResolvedValue({ id: 9n, userId: 2n, roleId: 5n, grantedBy: 1n, revokedBy: 1n }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      roleGrantAudit: { create: vi.fn().mockResolvedValue({}) },
      shopProduct: { updateMany: offSale },
      notification: { create: vi.fn().mockResolvedValue({}) },
    }) as never);
    const invalidatePermissions = vi.spyOn(app!.realtime, 'invalidatePermissions');
    const token = await app!.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });

    const response = await app!.inject({
      method: 'POST',
      url: '/api/admin/role-grants/9/revoke',
      headers: { authorization: `Bearer ${token}` },
      payload: { reason: '授权结束' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().grant).toMatchObject({ id: '9', userId: '2', roleId: '5', grantedBy: '1', revokedBy: '1' });
    expect(offSale).toHaveBeenCalledWith({
      where: { publisherId: 2n, status: 'on_sale' },
      data: { status: 'off_sale' },
    });
    expect(invalidatePermissions).toHaveBeenCalledWith([2n]);
  });

  it('off-sales affected products when a publishing role is disabled', async () => {
    await setup([PERMISSION_KEYS.permissionRoleEdit]);
    vi.spyOn(prisma.role, 'findUnique').mockResolvedValue({ id: 5n, enabled: true, systemProtected: false } as never);
    const offSale = vi.fn().mockResolvedValue({ count: 1 });
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      role: { update: vi.fn().mockResolvedValue({ id: 5n, enabled: false, systemProtected: false }) },
      userRoleGrant: {
        findMany: vi.fn().mockImplementation(async (args: any) => args?.where?.roleId === 5n
          ? [{ userId: 2n }]
          : []),
      },
      shopProduct: { updateMany: offSale },
      notification: { create: vi.fn().mockResolvedValue({}) },
    }) as never);
    vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({} as never);
    const invalidatePermissions = vi.spyOn(app!.realtime, 'invalidatePermissions');
    const token = await app!.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });

    const response = await app!.inject({
      method: 'PATCH',
      url: '/api/admin/roles/5',
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: false },
    });

    expect(response.statusCode).toBe(200);
    expect(offSale).toHaveBeenCalledWith({
      where: { publisherId: 2n, status: 'on_sale' },
      data: { status: 'off_sale' },
    });
    expect(invalidatePermissions).toHaveBeenCalledWith();
  });
});
