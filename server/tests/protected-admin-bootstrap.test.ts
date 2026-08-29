import { describe, expect, it } from 'vitest';
import { validateProtectedAdminPasswords } from '../src/protected-admin-bootstrap.js';

describe('protected administrator bootstrap', () => {
  it('accepts two distinct confirmed passwords', () => {
    expect(() => validateProtectedAdminPasswords({ first: 'first-password', firstConfirmation: 'first-password', second: 'second-password', secondConfirmation: 'second-password' })).not.toThrow();
  });

  it('rejects mismatches, short passwords and shared passwords', () => {
    expect(() => validateProtectedAdminPasswords({ first: 'first-password', firstConfirmation: 'different', second: 'second-password', secondConfirmation: 'second-password' })).toThrowError('PASSWORD_CONFIRMATION_MISMATCH');
    expect(() => validateProtectedAdminPasswords({ first: 'short', firstConfirmation: 'short', second: 'second-password', secondConfirmation: 'second-password' })).toThrowError('PASSWORD_TOO_SHORT');
    expect(() => validateProtectedAdminPasswords({ first: 'same-password', firstConfirmation: 'same-password', second: 'same-password', secondConfirmation: 'same-password' })).toThrowError('PASSWORDS_MUST_DIFFER');
  });
});
