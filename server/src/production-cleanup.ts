export const PRODUCTION_ALLOWLIST = ['蛋总-敦敦', '蛋总-千焦', '教练'] as const;
export const PRODUCTION_CLEANUP_CONFIRMATION = '--confirm=DELETE_NON_ALLOWLISTED_USERS';

export function assertCleanupConfirmation(args: readonly string[]): void {
  if (!args.includes(PRODUCTION_CLEANUP_CONFIRMATION)) throw new Error('CLEANUP_CONFIRMATION_REQUIRED');
}

interface CleanupUser {
  id: bigint;
  nickname: string;
  role: string;
  status: string;
  protectedAdminKey: string | null;
}

interface CleanupTransaction {
  user: {
    findMany(args: unknown): Promise<CleanupUser[]>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
  feedbackAttachment: { deleteMany(args: unknown): Promise<{ count: number }> };
  pointTransaction: {
    deleteMany(args: unknown): Promise<{ count: number }>;
    create(args: unknown): Promise<unknown>;
  };
  pointAccount: { upsert(args: unknown): Promise<unknown> };
}

export interface CleanupClient {
  $transaction<T>(callback: (tx: CleanupTransaction) => Promise<T>): Promise<T>;
}

export function assertCleanupAllowlist(users: readonly CleanupUser[]): void {
  const expected = new Set<string>(PRODUCTION_ALLOWLIST);
  const actual = new Set(users.map((user) => user.nickname));
  if (PRODUCTION_ALLOWLIST.some((nickname) => !actual.has(nickname))) throw new Error('CLEANUP_ALLOWLIST_MISSING');
  if (users.length !== PRODUCTION_ALLOWLIST.length || users.some((user) => !expected.has(user.nickname))) throw new Error('CLEANUP_ALLOWLIST_UNEXPECTED');

  const byNickname = new Map(users.map((user) => [user.nickname, user]));
  const first = byNickname.get('蛋总-敦敦');
  const second = byNickname.get('蛋总-千焦');
  const coach = byNickname.get('教练');
  if (first?.role !== 'admin' || second?.role !== 'admin' || coach?.role !== 'student') throw new Error('CLEANUP_ALLOWLIST_ROLE_INVALID');
  if (first.protectedAdminKey !== 'fixed-administrator-1' || second.protectedAdminKey !== 'fixed-administrator-2' || coach.protectedAdminKey !== null) throw new Error('CLEANUP_ALLOWLIST_PROTECTION_INVALID');
  if (users.some((user) => user.status !== 'active')) throw new Error('CLEANUP_ALLOWLIST_STATUS_INVALID');
}

function assertRequestedAllowlist(allowlist: readonly string[]) {
  const requested = new Set(allowlist);
  if (allowlist.length !== PRODUCTION_ALLOWLIST.length || PRODUCTION_ALLOWLIST.some((nickname) => !requested.has(nickname))) {
    throw new Error('CLEANUP_ALLOWLIST_ARGUMENT_INVALID');
  }
}

export async function cleanupProductionData(client: CleanupClient, allowlist: readonly string[]) {
  assertRequestedAllowlist(allowlist);
  return client.$transaction(async (tx) => {
    const users = await tx.user.findMany({
      where: { nickname: { in: [...allowlist] } },
      select: { id: true, nickname: true, role: true, status: true, protectedAdminKey: true },
    });
    assertCleanupAllowlist(users);
    const byNickname = new Map(users.map((user) => [user.nickname, user]));
    const retained = PRODUCTION_ALLOWLIST.map((nickname) => byNickname.get(nickname)!);
    const retainedIds = retained.map((user) => user.id);

    await tx.feedbackAttachment.deleteMany({ where: { uploaderId: { notIn: retainedIds } } });
    const deletedPointTransactions = await tx.pointTransaction.deleteMany({});
    const deletedUsers = await tx.user.deleteMany({ where: { id: { notIn: retainedIds } } });

    for (const user of retained) {
      await tx.pointAccount.upsert({
        where: { userId: user.id },
        create: { userId: user.id, availableBalance: 100, frozenBalance: 0, version: 0 },
        update: { availableBalance: 100, frozenBalance: 0, version: 0 },
      });
      await tx.pointTransaction.create({
        data: {
          userId: user.id,
          type: 'register_bonus',
          deltaAvailable: 100,
          deltaFrozen: 0,
          balanceAvailable: 100,
          balanceFrozen: 0,
          idempotencyKey: `production-initial-bonus:${user.id.toString()}`,
          remark: '初次上线 +100 蛋蛋币',
        },
      });
    }

    return {
      deletedUsers: deletedUsers.count,
      deletedPointTransactions: deletedPointTransactions.count,
      retainedUsers: retained.length,
    };
  });
}
