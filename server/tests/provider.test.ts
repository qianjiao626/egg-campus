import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('verification provider configuration', () => {
  it('rejects the removed Tencent SMS provider even when legacy settings are present', () => {
    expect(() => loadConfig({
      DATABASE_URL: 'mysql://test',
      JWT_SECRET: 'a'.repeat(32),
      VERIFICATION_PROVIDER: 'tencent_sms',
      TENCENTCLOUD_SECRET_ID: 'legacy-id',
      TENCENTCLOUD_SECRET_KEY: 'legacy-key',
      TENCENT_SMS_SDK_APP_ID: 'legacy-app',
      TENCENT_SMS_SIGN_NAME: 'legacy-sign',
      TENCENT_SMS_TEMPLATE_ID: 'legacy-template',
    })).toThrow();
  });

  it('accepts an explicitly disabled verification provider', () => {
    expect(loadConfig({ DATABASE_URL: 'mysql://test', JWT_SECRET: 'a'.repeat(32), VERIFICATION_PROVIDER: 'disabled' }).VERIFICATION_PROVIDER).toBe('disabled');
  });
});
