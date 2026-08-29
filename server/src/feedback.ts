import { z } from 'zod';

export const feedbackStatusSchema = z.enum([
  'pending',
  'processing',
  'needs_changes',
  'resolved',
  'rejected',
]);

export type FeedbackStatus = z.infer<typeof feedbackStatusSchema>;

export class FeedbackRuleError extends Error {
  readonly code:
    | 'FEEDBACK_TRANSITION_INVALID'
    | 'FEEDBACK_APPEND_NOT_ALLOWED'
    | 'FEEDBACK_REOPEN_NOT_ALLOWED';

  constructor(code: FeedbackRuleError['code']) {
    super(code);
    this.name = 'FeedbackRuleError';
    this.code = code;
  }
}

const allowedTransitions: Record<FeedbackStatus, readonly FeedbackStatus[]> = {
  pending: ['processing', 'needs_changes', 'resolved', 'rejected'],
  processing: ['pending', 'needs_changes', 'resolved', 'rejected'],
  needs_changes: ['pending', 'processing', 'resolved', 'rejected'],
  resolved: [],
  rejected: [],
};

export function mapLegacyFeedbackStatus(status: string): FeedbackStatus {
  if (status === 'open') return 'pending';
  if (status === 'closed') return 'resolved';
  const parsed = feedbackStatusSchema.safeParse(status);
  return parsed.success ? parsed.data : 'pending';
}

export function assertFeedbackTransition(from: FeedbackStatus, to: FeedbackStatus): void {
  if (from === to) return;
  if (!allowedTransitions[from].includes(to)) {
    throw new FeedbackRuleError('FEEDBACK_TRANSITION_INVALID');
  }
}

export function canUserAppendFeedback(status: FeedbackStatus): boolean {
  return status === 'needs_changes';
}

export function canReopenFeedback(
  feedback: { status: string; closedAt: Date | null; reopenCount: number },
  now = new Date(),
): boolean {
  if (feedback.status !== 'resolved' && feedback.status !== 'rejected') return false;
  if (!feedback.closedAt || feedback.reopenCount >= 1) return false;
  const deadline = feedback.closedAt.getTime() + 7 * 24 * 60 * 60 * 1000;
  return now.getTime() <= deadline;
}

export function assertUserCanAppendFeedback(status: FeedbackStatus): void {
  if (!canUserAppendFeedback(status)) throw new FeedbackRuleError('FEEDBACK_APPEND_NOT_ALLOWED');
}

export function assertFeedbackCanReopen(
  feedback: { status: string; closedAt: Date | null; reopenCount: number },
  now = new Date(),
): void {
  if (!canReopenFeedback(feedback, now)) throw new FeedbackRuleError('FEEDBACK_REOPEN_NOT_ALLOWED');
}
