import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prepareProfileUpdate, profileUpdateSchema } from '../src/profile.js';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';

const now = new Date('2026-08-26T12:00:00.000Z');
const current = {
  nickname: '旧昵称',
  email: 'old@example.com',
  nicknameChangedAt: null,
  protectedAdminKey: null,
};

describe('profile update rules', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.restoreAllMocks();
  });

  it('normalizes MBTI and deduplicates profile tags', () => {
    const input = profileUpdateSchema.parse({
      mbtiType: 'intj',
      interests: [' 摄影 ', '摄影', '跑步'],
      skills: ['TypeScript', ' TypeScript ', '设计'],
    });
    const result = prepareProfileUpdate(current, input, now);

    expect(result.userData).toMatchObject({
      mbtiType: 'INTJ',
      mbtiGroup: 'NT',
      interests: ['摄影', '跑步'],
      skills: ['TypeScript', '设计'],
    });
    expect(result.buddyData).toEqual({ mbtiType: 'INTJ', hobbies: ['摄影', '跑步'] });
  });

  it('starts a 30-day cooldown only when nickname changes', () => {
    expect(prepareProfileUpdate(current, profileUpdateSchema.parse({ nickname: '旧昵称' }), now).userData)
      .not.toHaveProperty('nicknameChangedAt');
    expect(prepareProfileUpdate(current, profileUpdateSchema.parse({ nickname: '新昵称' }), now).userData)
      .toMatchObject({ nickname: '新昵称', nicknameChangedAt: now });
  });

  it('rejects nickname changes during cooldown', () => {
    const changedYesterday = { ...current, nicknameChangedAt: new Date('2026-08-25T12:00:00.000Z') };
    expect(() => prepareProfileUpdate(changedYesterday, profileUpdateSchema.parse({ nickname: '新昵称' }), now))
      .toThrowError(/NICKNAME_CHANGE_COOLDOWN/);
  });

  it('locks protected administrator nicknames', () => {
    const administrator = { ...current, protectedAdminKey: 'fixed-admin-1' };
    expect(() => prepareProfileUpdate(administrator, profileUpdateSchema.parse({ nickname: '新昵称' }), now))
      .toThrowError(/PROTECTED_ADMIN_NICKNAME/);
  });

  it('clears email verification only when email changes', () => {
    expect(prepareProfileUpdate(current, profileUpdateSchema.parse({ email: 'old@example.com' }), now).userData)
      .not.toHaveProperty('verifiedEmailAt');
    expect(prepareProfileUpdate(current, profileUpdateSchema.parse({ email: 'new@example.com' }), now).userData)
      .toMatchObject({ email: 'new@example.com', verifiedEmailAt: null });
  });

  it('does not accept phone updates', () => {
    const result = profileUpdateSchema.safeParse({ phone: '13800000000' });
    expect(result.success).toBe(false);
  });

  it('updates canonical profile and buddy data in one API transaction', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();

    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({
      id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60_000),
    } as never);
    const updateUser = vi.fn().mockResolvedValue({
      id: 1n,
      nickname: '新昵称',
      email: 'new@example.com',
      phone: null,
      role: 'student',
      status: 'active',
      school: null,
      major: null,
      city: null,
      grade: null,
      age: 20,
      bio: null,
      mbtiType: 'INTJ',
      mbtiGroup: 'NT',
      likes: 0,
      reputation: 0,
      eggCategory: 'study',
      eggRarity: 'N',
      inviteCode: null,
      interests: ['摄影'],
      skills: ['设计'],
      mustChangePassword: false,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    });
    const upsertBuddy = vi.fn().mockResolvedValue({ userId: 1n });
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      user: {
        findUnique: vi.fn().mockResolvedValue(current),
        update: updateUser,
      },
      buddyPreference: { upsert: upsertBuddy },
    }) as never);
    vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({ id: 1n } as never);

    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const response = await app.inject({
      method: 'PUT',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { nickname: '新昵称', email: 'new@example.com', mbtiType: 'intj', interests: ['摄影'], skills: ['设计'] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({ nickname: '新昵称', mbtiType: 'INTJ', interests: ['摄影'], skills: ['设计'] });
    expect(updateUser).toHaveBeenCalledOnce();
    expect(upsertBuddy).toHaveBeenCalledOnce();
  });

  it('returns received ratings with server-calculated aggregate data', async () => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();

    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({
      id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60_000),
    } as never);
    const findMany = vi.spyOn(prisma.rating, 'findMany').mockResolvedValue([{
      id: 9n,
      taskId: 12n,
      fromUserId: 2n,
      toUserId: 1n,
      score: 5,
      comment: '讲解清晰',
      createdAt: now,
      fromUser: { id: 2n, nickname: '评价者' },
      task: { id: 12n, title: 'TypeScript 学习' },
    }] as never);
    vi.spyOn(prisma.rating, 'aggregate').mockResolvedValue({ _avg: { score: 5 }, _count: { _all: 1 } } as never);

    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const response = await app.inject({ method: 'GET', url: '/api/users/me/ratings', headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(200);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { toUserId: 1n } }));
    expect(response.json()).toMatchObject({
      average: 5,
      count: 1,
      ratings: [{ id: '9', score: 5, comment: '讲解清晰', from: { id: '2', nickname: '评价者' }, task: { id: '12', title: 'TypeScript 学习' } }],
    });
  });
});
