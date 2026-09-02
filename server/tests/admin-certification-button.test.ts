import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(resolve(process.cwd(), '../backend-handoff-package/growth-school.html'), 'utf8');
const client = readFileSync(resolve(process.cwd(), '../backend-handoff-package/api-client.js'), 'utf8');

describe('admin certification controls', () => {
  it('renders a certification action for protected admins in the user list', () => {
    expect(html).toContain('if(USER.isProtectedAdmin)');
    expect(html).toContain('toggleCertify(');
    expect(html).toContain("'蛋总认定'");
    expect(html).toContain("'撤销认定'");
  });

  it('provides the certification API client method', () => {
    expect(client).toContain('adminCertifyUser: function');
    expect(client).toContain("'/certify'");
  });

  it('hydrates the canonical administrator context after password login', () => {
    expect(html).toContain('var canonical = await window.apiClient.me()');
    expect(html).toContain('if(canonical && canonical.user) user = canonical.user');
  });
});
