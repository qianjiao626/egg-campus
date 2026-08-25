import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { TencentSmsVerificationProvider } from '../src/auth/provider.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Tencent SMS provider', () => {
  it('signs and sends a verification request without logging the code', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ Response: { SendStatusSet: [{ Code: 'Ok' }] } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new TencentSmsVerificationProvider({
      secretId: 'secret-id',
      secretKey: 'secret-key',
      sdkAppId: '1400000000',
      signName: '蛋蛋校园',
      templateId: '100000',
      region: 'ap-nanjing',
    });

    await provider.send({ channel: 'sms', target: '13800000000', code: '123456', purpose: 'register' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sms.tencentcloudapi.com');
    expect(request.headers).toMatchObject({ 'X-TC-Action': 'SendSms', 'X-TC-Region': 'ap-nanjing' });
    expect(String(request.body)).toContain('123456');
    expect(String(request.headers && (request.headers as Record<string, string>).Authorization)).toContain('Credential=secret-id/');
  });

  it('requires all Tencent SMS settings when selected', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://test', JWT_SECRET: 'a'.repeat(32), VERIFICATION_PROVIDER: 'tencent_sms' })).toThrow();
  });
});
