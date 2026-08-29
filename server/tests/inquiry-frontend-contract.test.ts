import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const apiClient = readFileSync(new URL('../../backend-handoff-package/api-client.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../backend-handoff-package/growth-school.html', import.meta.url), 'utf8');

describe('inquiry frontend contract', () => {
  it('uses the canonical mine route and redacts raw backend route errors', () => {
    expect(apiClient).toContain("myInquiries: function () { return request('/api/inquiries/mine'); }");
    expect(apiClient).toContain('safeApiErrorMessage');
    expect(apiClient).toMatch(/Route\\s\+\(GET\|POST\|PUT\|PATCH\|DELETE\)/);
  });

  it('preserves publish success when the list refresh fails', () => {
    expect(page).toContain('createdInquiryResponse = await window.apiClient.createInquiry');
    expect(page).toContain('var inquiryRefreshSucceeded = await syncGossipInquiries(true);');
    expect(page).toContain('打听已发布，列表刷新失败，请稍后点击刷新');
    expect(page).not.toContain("catch(error) { toast(error.message || '打听加载失败，请稍后重试'); }");
  });
});
