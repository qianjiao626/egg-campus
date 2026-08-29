import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { bindInvitation, InvitationError, rewardInvitationForApprovedTask } from '../src/invitations.js';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';

describe('invitation domain contract', () => {
  it('rejects an unknown or inactive invite code', async () => {
    const tx = { user: { findUnique: vi.fn().mockResolvedValue(null) }, invitation: { create: vi.fn() } };
    await expect(bindInvitation(tx as never, 2n, 'MISSING1')).rejects.toMatchObject({ code: 'INVITE_CODE_INVALID' });
    expect(tx.invitation.create).not.toHaveBeenCalled();
  });

  it('rejects self-invitation and duplicate binding with stable business errors', async () => {
    const selfTx = {
      user: { findUnique: vi.fn().mockResolvedValue({ id: 2n, status: 'active' }) },
      invitation: { create: vi.fn() },
    };
    await expect(bindInvitation(selfTx as never, 2n, 'SELF0001')).rejects.toMatchObject({ code: 'INVITE_SELF_FORBIDDEN' });

    const duplicate = Object.assign(new Error('duplicate'), { code: 'P2002' });
    const duplicateTx = {
      user: { findUnique: vi.fn().mockResolvedValue({ id: 1n, status: 'active' }) },
      invitation: { create: vi.fn().mockRejectedValue(duplicate) },
    };
    await expect(bindInvitation(duplicateTx as never, 2n, 'KNOWN001')).rejects.toMatchObject({ code: 'INVITE_ALREADY_BOUND' });
  });

  it('rewards only the first approved task and writes an idempotent point ledger entry', async () => {
    const invitation = { id: 8n, inviterId: 1n, invitedUserId: 2n, rewardedAt: null };
    const tx = {
      invitation: {
        findUnique: vi.fn().mockResolvedValue(invitation),
        updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }),
      },
      pointAccount: {
        update: vi.fn().mockResolvedValue({ userId: 1n, availableBalance: 120, frozenBalance: 0 }),
      },
      pointTransaction: { create: vi.fn().mockResolvedValue({ id: 30n }) },
    };

    const first = await rewardInvitationForApprovedTask(tx as never, 2n, 50n, new Date('2026-08-27T01:00:00.000Z'));
    const second = await rewardInvitationForApprovedTask(tx as never, 2n, 51n, new Date('2026-08-27T01:01:00.000Z'));

    expect(first).toEqual({ rewarded: true, inviterId: 1n });
    expect(second).toEqual({ rewarded: false });
    expect(tx.pointAccount.update).toHaveBeenCalledTimes(1);
    expect(tx.pointAccount.update).toHaveBeenCalledWith({ where: { userId: 1n }, data: { availableBalance: { increment: 20 }, version: { increment: 1 } } });
    expect(tx.pointTransaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: 1n,
      type: 'invite_reward',
      deltaAvailable: 20,
      balanceAvailable: 120,
      idempotencyKey: 'invite-reward:8',
      remark: '邀请好友首次发布任务审核通过 +20 蛋蛋币',
    }) });
  });

  it('exposes typed invitation errors', () => {
    expect(new InvitationError('INVITE_CODE_INVALID', '邀请码无效')).toMatchObject({ code: 'INVITE_CODE_INVALID', message: '邀请码无效' });
  });
});

describe('invitation HTTP contract', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  async function readyApp() {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    app = buildApp();
    await app.ready();
  }

  it('returns a readable registration error for an invalid invite code', async () => {
    await readyApp();
    const created = {
      id: 2n, nickname: '受邀新用户', email: null, phone: null, passwordHash: 'hash', role: 'student', status: 'active',
      school: null, major: null, city: null, grade: null, age: null, bio: null, mbtiType: null, mbtiGroup: null,
      likes: 0, reputation: 0, eggCategory: 'study', eggRarity: 'N', inviteCode: 'NEWUSER2', createdAt: new Date(), updatedAt: new Date(), lastLoginAt: null,
    };
    const tx = {
      user: { create: vi.fn().mockResolvedValue(created), findUnique: vi.fn().mockResolvedValue(null) },
      pointTransaction: { create: vi.fn().mockResolvedValue({}) },
      invitation: { create: vi.fn() },
    };
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback(tx));

    const response = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { nickname: created.nickname, password: 'correct-password', inviteCode: 'MISSING1' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'INVITE_CODE_INVALID', message: '邀请码无效或邀请人已失效' });
  });

  it('returns invitation summary and reward status from stored relations', async () => {
    await readyApp();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60_000) } as never);
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({ inviteCode: 'INVITER1' } as never);
    vi.spyOn(prisma.invitation, 'findMany').mockResolvedValue([{
      id: 8n, inviterId: 1n, invitedUserId: 2n, inviteCode: 'INVITER1', rewardedAt: new Date('2026-08-27T01:00:00.000Z'), rewardedTaskId: 50n,
      createdAt: new Date('2026-08-27T00:00:00.000Z'), updatedAt: new Date('2026-08-27T01:00:00.000Z'),
      invitedUser: { id: 2n, nickname: '受邀用户', status: 'active', createdAt: new Date('2026-08-27T00:00:00.000Z') },
    }] as never);
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });

    const response = await app.inject({ method: 'GET', url: '/api/users/me/invitations', headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ inviteCode: 'INVITER1', invitedCount: 1, rewardedCount: 1, totalReward: 20 });
    expect(response.json().invitations[0]).toMatchObject({ id: '8', rewardedTaskId: '50', status: 'rewarded', reward: 20, invitedUser: { id: '2', nickname: '受邀用户' } });
  });
});
