import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageRoot = resolve(process.cwd(), '..', 'backend-handoff-package');
const html = readFileSync(resolve(packageRoot, 'growth-school.html'), 'utf8');
const client = readFileSync(resolve(packageRoot, 'api-client.js'), 'utf8');

describe('frontend password reset contract', () => {
  it('exposes reset fields and calls the password reset API', () => {
    expect(html).toContain('id="forgotPasswordOverlay"');
    expect(html).toContain('id="resetTarget"');
    expect(html).toContain('id="resetCode"');
    expect(html).toContain('id="resetNewPassword"');
    expect(client).toContain("'/api/auth/password-reset/request'");
    expect(client).toContain("'/api/auth/password-reset/confirm'");
    expect(client).toContain('requestPasswordReset: function');
    expect(client).toContain('window.sendPasswordResetCode');
  });

  it('restores an HttpOnly cookie session after a page reload', () => {
    expect(client).toContain('restoreSession: async function');
    expect(client).toContain("'/api/auth/refresh'");
    expect(client).toContain("dandan:session-restored");
    expect(client).toContain("credentials: 'include'");
    expect(html).toContain('dandan:session-restored');
  });

  it('uses the server login endpoint for administrator sessions', () => {
    expect(html).toContain('onclick="doStudentLogin()"');
    expect(html).toContain('id="adminIdentifier"');
    expect(html).toContain('apiClient.login(identifier, pwd)');
    expect(html).not.toContain("pwd !== '123'");
    expect(client).toContain("'/api/auth/login'");
  });

  it('attempts server logout even when the access token is not yet in memory', () => {
    expect(client).toContain("request('/api/auth/logout', { method: 'POST' })");
    expect(client).toContain('if (!accessToken)');
    expect(client).toContain('await apiClient.refresh()');
  });

  it('does not persist credentials in browser storage', () => {
    expect(client).not.toMatch(/localStorage|sessionStorage/);
    expect(html).not.toMatch(/localStorage|sessionStorage/);
  });

  it('allows nickname/password registration with optional contact verification', () => {
    expect(client).toContain("if (!nick || !password || !confirm)");
    expect(client).toContain("if ((email || phone) && code)");
    expect(html).toContain('邮箱和手机号均为可选；填写验证码后才会验证联系方式。');
  });
});

describe('blind-box persistence contract', () => {
  it('restores board and feature state from the current user records', () => {
    const client = readFileSync(resolve(packageRoot, 'blind-box', 'buddy-box-api.js'), 'utf8');
    const app = readFileSync(resolve(packageRoot, 'blind-box', 'app.js'), 'utf8');
    expect(client).toContain('getBoard: function');
    expect(client).toContain('getFeatureRecords: function');
    expect(app).toContain('syncBuddyBoard()');
    expect(app).toContain('syncBuddyFeatureState()');
    expect(app).toContain("record.feature");
  });
});
