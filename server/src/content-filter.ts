const blockedTerms = ['加微信', '加我微信', '手机号', '裸聊', '色情', '博彩', '刷单'];

export const CONTENT_BLOCKED_MESSAGE = '内容包含敏感词，请修改后再提交';

export function validateUserText(value: unknown) {
  const text = String(value ?? '').replace(/\s+/g, '');
  const blocked = blockedTerms.some((term) => text.includes(term));
  return { blocked, message: blocked ? CONTENT_BLOCKED_MESSAGE : null };
}

export function assertSafeText(...values: unknown[]) {
  if (values.some((value) => validateUserText(value).blocked)) {
    const error = new Error(CONTENT_BLOCKED_MESSAGE);
    error.name = 'ContentBlockedError';
    throw error;
  }
}

export function assertSafeJsonText(value: unknown) {
  if (typeof value === 'string') {
    assertSafeText(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(assertSafeJsonText);
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(assertSafeJsonText);
  }
}
