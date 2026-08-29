import type { Prisma } from '@prisma/client';

export class InvitationError extends Error {
  constructor(readonly code: 'INVITE_CODE_INVALID' | 'INVITE_SELF_FORBIDDEN' | 'INVITE_ALREADY_BOUND' | 'INVITE_REWARD_FAILED', message: string) {
    super(message);
    this.name = 'InvitationError';
  }
}

type InvitationClient = Pick<Prisma.TransactionClient, 'user' | 'invitation' | 'pointAccount' | 'pointTransaction'>;

export async function bindInvitation(tx: InvitationClient, invitedUserId: bigint, inviteCode: string): Promise<void> {
  const inviter = await tx.user.findUnique({ where: { inviteCode }, select: { id: true, status: true } });
  if (!inviter || inviter.status !== 'active') throw new InvitationError('INVITE_CODE_INVALID', '邀请码无效或邀请人已失效');
  if (inviter.id === invitedUserId) throw new InvitationError('INVITE_SELF_FORBIDDEN', '不能填写自己的邀请码');
  try {
    await tx.invitation.create({ data: { inviterId: inviter.id, invitedUserId, inviteCode } });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      throw new InvitationError('INVITE_ALREADY_BOUND', '该用户已经绑定过邀请码');
    }
    throw error;
  }
}

export async function rewardInvitationForApprovedTask(
  tx: InvitationClient,
  invitedUserId: bigint,
  taskId: bigint,
  now = new Date(),
): Promise<{ rewarded: boolean; inviterId?: bigint }> {
  const relation = await tx.invitation.findUnique({ where: { invitedUserId } });
  if (!relation || relation.rewardedAt) return { rewarded: false };
  const claimed = await tx.invitation.updateMany({
    where: { id: relation.id, rewardedAt: null },
    data: { rewardedAt: now, rewardedTaskId: taskId },
  });
  if (claimed.count !== 1) return { rewarded: false };
  const account = await tx.pointAccount.update({
    where: { userId: relation.inviterId },
    data: { availableBalance: { increment: 20 }, version: { increment: 1 } },
  });
  await tx.pointTransaction.create({
    data: {
      userId: relation.inviterId,
      type: 'invite_reward',
      deltaAvailable: 20,
      deltaFrozen: 0,
      balanceAvailable: account.availableBalance,
      balanceFrozen: account.frozenBalance,
      taskId,
      idempotencyKey: `invite-reward:${relation.id.toString()}`,
      remark: '邀请好友首次发布任务审核通过 +20 蛋蛋币',
      createdAt: now,
    },
  });
  return { rewarded: true, inviterId: relation.inviterId };
}
