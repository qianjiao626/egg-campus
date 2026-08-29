import { describe, expect, it } from 'vitest';
import { validateIsolatedE2EBootstrapInput } from '../src/isolated-e2e-guard.js';

describe('isolated E2E bootstrap guard', () => {
  it('accepts only the dedicated test database and administrator identity', () => {
    expect(validateIsolatedE2EBootstrapInput({
      databaseUrl: 'mysql://test-user:test-password@127.0.0.1:3306/dandan_campus_test',
      identifier: 'isolated-e2e-admin',
      password: 'temporary-password-123',
    })).toEqual({ databaseName: 'dandan_campus_test', identifier: 'isolated-e2e-admin' });
  });

  it.each([
    ['mysql://user:password@127.0.0.1:3306/dandan_world', 'isolated-e2e-admin', 'temporary-password-123', 'ISOLATED_TEST_DATABASE_REQUIRED'],
    ['not-a-url', 'isolated-e2e-admin', 'temporary-password-123', 'INVALID_DATABASE_URL'],
    ['mysql://user:password@127.0.0.1:3306/dandan_campus_test', 'other-admin', 'temporary-password-123', 'INVALID_E2E_ADMIN_IDENTIFIER'],
    ['mysql://user:password@127.0.0.1:3306/dandan_campus_test', 'isolated-e2e-admin', 'short', 'INVALID_E2E_ADMIN_PASSWORD'],
  ])('rejects unsafe bootstrap input %#', (databaseUrl, identifier, password, errorCode) => {
    expect(() => validateIsolatedE2EBootstrapInput({ databaseUrl, identifier, password })).toThrowError(errorCode);
  });
});
