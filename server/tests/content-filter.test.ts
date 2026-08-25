import { describe, expect, it } from 'vitest';
import { assertSafeJsonText, validateUserText } from '../src/content-filter.js';

describe('shared content filter', () => {
  it('rejects blocked text without exposing the matched term', () => {
    const result = validateUserText('请加微信联系我');
    expect(result.blocked).toBe(true);
    expect(result.message).toBe('内容包含敏感词，请修改后再提交');
    expect(result.message).not.toContain('微信');
  });

  it('accepts ordinary text', () => {
    expect(validateUserText('一起在图书馆自习').blocked).toBe(false);
  });

  it('uses the bundled Chinese word list for high-signal terms', () => {
    const result = validateUserText('这是诈骗信息');
    expect(result.blocked).toBe(true);
    expect(result.message).toBe('内容包含敏感词，请修改后再提交');
    expect(result.message).not.toContain('诈骗');
  });

  it('detects separator-inserted variants without exposing the matched term', () => {
    expect(validateUserText('诈-骗').blocked).toBe(true);
  });

  it('walks nested JSON payloads without exposing the matched term', () => {
    expect(() => assertSafeJsonText({ fields: [{ answer: '请加微信' }] })).toThrow('内容包含敏感词，请修改后再提交');
  });
});
