import type { Prisma } from '@prisma/client';

export type TaskVisibilityView = 'public' | 'review' | 'mine';

export function taskVisibilityWhere(input: {
  userId: bigint;
  canReview: boolean;
  view: TaskVisibilityView;
}): Prisma.TaskWhereInput {
  if (input.view === 'public') return { status: 'approved' };
  if (input.view === 'mine') return { userId: input.userId };
  if (!input.canReview) throw new Error('TASK_REVIEW_PERMISSION_REQUIRED');
  return { status: { in: ['pending_review', 'needs_revision', 'rejected'] } };
}
