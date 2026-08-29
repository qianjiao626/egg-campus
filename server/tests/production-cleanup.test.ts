import { describe, expect, it, vi } from 'vitest';
import { assertCleanupAllowlist, cleanupProductionData, PRODUCTION_ALLOWLIST } from '../src/production-cleanup.js';
import * as productionCleanup from '../src/production-cleanup.js';

const users = [
  { id: 1n, nickname: '蛋总-敦敦', role: 'admin', status: 'active', protectedAdminKey: 'fixed-administrator-1' },
  { id: 2n, nickname: '蛋总-千焦', role: 'admin', status: 'active', protectedAdminKey: 'fixed-administrator-2' },
  { id: 3n, nickname: '教练', role: 'student', status: 'active', protectedAdminKey: null },
] as const;

describe('production cleanup allowlist', () => {
  it('requires the exact destructive-operation confirmation token', () => {
    expect(() => (productionCleanup as any).assertCleanupConfirmation(['--confirm=DELETE_NON_ALLOWLISTED_USERS'])).not.toThrow();
    expect(() => (productionCleanup as any).assertCleanupConfirmation([])).toThrow('CLEANUP_CONFIRMATION_REQUIRED');
    expect(() => (productionCleanup as any).assertCleanupConfirmation(['--confirm=yes'])).toThrow('CLEANUP_CONFIRMATION_REQUIRED');
  });

  it('accepts only the two protected administrators and the ordinary coach account', () => {
    expect(() => assertCleanupAllowlist(users)).not.toThrow();
    expect(() => assertCleanupAllowlist(users.slice(0, 2))).toThrow('CLEANUP_ALLOWLIST_MISSING');
    expect(() => assertCleanupAllowlist([...users, { id: 4n, nickname: '额外账号', role: 'student', status: 'active', protectedAdminKey: null }])).toThrow('CLEANUP_ALLOWLIST_UNEXPECTED');
    expect(() => assertCleanupAllowlist(users.map((user) => user.nickname === '蛋总-千焦' ? { ...user, role: 'student' } : user))).toThrow('CLEANUP_ALLOWLIST_ROLE_INVALID');
  });

  it('deletes non-allowlisted users and rebuilds one initial balance entry per retained account in one transaction', async () => {
    const transactionCreates: unknown[] = [];
    const tx = {
      user: {
        findMany: vi.fn().mockResolvedValue(users),
        deleteMany: vi.fn().mockResolvedValue({ count: 7 }),
      },
      feedbackAttachment: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      pointTransaction: {
        deleteMany: vi.fn().mockResolvedValue({ count: 19 }),
        create: vi.fn().mockImplementation(async (input: unknown) => { transactionCreates.push(input); return input; }),
      },
      pointAccount: { upsert: vi.fn().mockResolvedValue({}) },
    };
    const client = { $transaction: vi.fn(async (callback: any) => callback(tx)) };

    const result = await cleanupProductionData(client as never, PRODUCTION_ALLOWLIST);

    expect(client.$transaction).toHaveBeenCalledOnce();
    expect(tx.feedbackAttachment.deleteMany).toHaveBeenCalledWith({ where: { uploaderId: { notIn: [1n, 2n, 3n] } } });
    expect(tx.pointTransaction.deleteMany).toHaveBeenCalledWith({});
    expect(tx.user.deleteMany).toHaveBeenCalledWith({ where: { id: { notIn: [1n, 2n, 3n] } } });
    expect(tx.pointAccount.upsert).toHaveBeenCalledTimes(3);
    expect(transactionCreates).toHaveLength(3);
    expect(transactionCreates[0]).toEqual({ data: expect.objectContaining({
      userId: 1n, type: 'register_bonus', deltaAvailable: 100, balanceAvailable: 100,
      balanceFrozen: 0, remark: '初次上线 +100 蛋蛋币', idempotencyKey: 'production-initial-bonus:1',
    }) });
    expect(result).toEqual({ deletedUsers: 7, deletedPointTransactions: 19, retainedUsers: 3 });
  });
});
