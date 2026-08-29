import { describe, expect, it } from 'vitest';
import { taskVisibilityWhere } from '../src/task-visibility.js';

describe('task visibility rules', () => {
  it('exposes only approved tasks in the public task plaza', () => {
    expect(taskVisibilityWhere({ userId: 9n, canReview: false, view: 'public' }))
      .toEqual({ status: 'approved' });
  });

  it('exposes the complete review queue only to a reviewer', () => {
    expect(taskVisibilityWhere({ userId: 9n, canReview: true, view: 'review' }))
      .toEqual({ status: { in: ['pending_review', 'needs_revision', 'rejected'] } });
    expect(() => taskVisibilityWhere({ userId: 9n, canReview: false, view: 'review' }))
      .toThrowError('TASK_REVIEW_PERMISSION_REQUIRED');
  });

  it('scopes mine to the authenticated publisher without a status shortcut', () => {
    expect(taskVisibilityWhere({ userId: 9n, canReview: false, view: 'mine' }))
      .toEqual({ userId: 9n });
  });
});
