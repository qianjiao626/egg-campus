import { describe, expect, it } from 'vitest';
import {
  assertFeedbackTransition,
  canReopenFeedback,
  canUserAppendFeedback,
  feedbackStatusSchema,
  mapLegacyFeedbackStatus,
} from '../src/feedback.js';
import { MAX_FEEDBACK_ATTACHMENT_BYTES, ProtectedFileError, validateFeedbackAttachment } from '../src/protected-files.js';

describe('feedback timeline rules', () => {
  it('maps legacy statuses without losing closed records', () => {
    expect(mapLegacyFeedbackStatus('open')).toBe('pending');
    expect(mapLegacyFeedbackStatus('processing')).toBe('processing');
    expect(mapLegacyFeedbackStatus('resolved')).toBe('resolved');
    expect(mapLegacyFeedbackStatus('closed')).toBe('resolved');
  });

  it('accepts the five stable statuses', () => {
    for (const status of ['pending', 'processing', 'needs_changes', 'resolved', 'rejected']) {
      expect(feedbackStatusSchema.safeParse(status).success).toBe(true);
    }
    expect(feedbackStatusSchema.safeParse('closed').success).toBe(false);
  });

  it('allows administrators to progress or reopen active work states', () => {
    expect(() => assertFeedbackTransition('pending', 'processing')).not.toThrow();
    expect(() => assertFeedbackTransition('processing', 'needs_changes')).not.toThrow();
    expect(() => assertFeedbackTransition('needs_changes', 'resolved')).not.toThrow();
    expect(() => assertFeedbackTransition('needs_changes', 'pending')).not.toThrow();
  });

  it('blocks direct transitions out of terminal states', () => {
    expect(() => assertFeedbackTransition('resolved', 'processing')).toThrowError(/FEEDBACK_TRANSITION_INVALID/);
    expect(() => assertFeedbackTransition('rejected', 'pending')).toThrowError(/FEEDBACK_TRANSITION_INVALID/);
  });

  it('allows user additions only while changes are requested', () => {
    expect(canUserAppendFeedback('needs_changes')).toBe(true);
    expect(canUserAppendFeedback('pending')).toBe(false);
    expect(canUserAppendFeedback('resolved')).toBe(false);
  });

  it('allows one reopen within seven days including the boundary', () => {
    const closedAt = new Date('2026-08-20T12:00:00.000Z');
    expect(canReopenFeedback({ status: 'resolved', closedAt, reopenCount: 0 }, new Date('2026-08-27T12:00:00.000Z'))).toBe(true);
    expect(canReopenFeedback({ status: 'resolved', closedAt, reopenCount: 1 }, new Date('2026-08-21T12:00:00.000Z'))).toBe(false);
    expect(canReopenFeedback({ status: 'resolved', closedAt, reopenCount: 0 }, new Date('2026-08-27T12:00:00.001Z'))).toBe(false);
    expect(canReopenFeedback({ status: 'processing', closedAt: null, reopenCount: 0 }, new Date())).toBe(false);
  });
});

describe('protected feedback attachment rules', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nkwAAAAASUVORK5CYII=', 'base64');

  it('accepts a valid PNG and assigns an opaque storage key', async () => {
    const result = await validateFeedbackAttachment({ buffer: png, originalName: 'screen.png', declaredMime: 'image/png' });
    expect(result).toMatchObject({ mimeType: 'image/png', extension: 'png', sizeBytes: png.length, originalName: 'screen.png' });
    expect(result.storageKey).toMatch(/^[a-f0-9-]+\.png$/);
  });

  it.each([
    ['declared MIME mismatch', { buffer: png, originalName: 'screen.png', declaredMime: 'image/jpeg' }],
    ['invalid magic number', { buffer: Buffer.from('not an image'), originalName: 'screen.png', declaredMime: 'image/png' }],
    ['path traversal name', { buffer: png, originalName: '../screen.png', declaredMime: 'image/png' }],
    ['unsupported extension', { buffer: png, originalName: 'screen.gif', declaredMime: 'image/png' }],
    ['oversized file', { buffer: Buffer.alloc(MAX_FEEDBACK_ATTACHMENT_BYTES + 1), originalName: 'screen.png', declaredMime: 'image/png' }],
  ])('rejects %s', async (_label, input) => {
    await expect(validateFeedbackAttachment(input)).rejects.toBeInstanceOf(ProtectedFileError);
  });
});
