import { describe, expect, it } from 'vitest';
import {
  assertIsolatedCleanupDatabase,
  assertProtectedIsolatedAdmin,
  selectIsolatedE2EUsers,
} from '../src/isolated-e2e-cleanup.js';

describe('isolated E2E cleanup guard', () => {
  it('accepts only the dedicated test database', () => {
    expect(() => assertIsolatedCleanupDatabase('mysql://user:password@127.0.0.1:3306/dandan_campus_test')).not.toThrow();
    expect(() => assertIsolatedCleanupDatabase('mysql://user:password@127.0.0.1:3306/dandan_world')).toThrow('ISOLATED_TEST_DATABASE_REQUIRED');
    expect(() => assertIsolatedCleanupDatabase('not-a-url')).toThrow('INVALID_DATABASE_URL');
  });

  it('requires exactly one protected isolated administrator', () => {
    expect(() => assertProtectedIsolatedAdmin([
      { id: 1n, nickname: 'isolated-e2e-admin', protectedAdminKey: 'isolated-e2e-admin' },
    ])).not.toThrow();
    expect(() => assertProtectedIsolatedAdmin([])).toThrow('ISOLATED_E2E_ADMIN_REQUIRED');
    expect(() => assertProtectedIsolatedAdmin([
      { id: 1n, nickname: 'isolated-e2e-admin', protectedAdminKey: 'wrong' },
      { id: 2n, nickname: 'isolated-e2e-admin', protectedAdminKey: 'isolated-e2e-admin' },
    ])).toThrow('ISOLATED_E2E_ADMIN_REQUIRED');
  });

  it('selects only unprotected non-admin users and never targets the admin', () => {
    const users = [
      { id: 1n, nickname: 'isolated-e2e-admin', protectedAdminKey: 'isolated-e2e-admin' },
      { id: 2n, nickname: '验收甲123', protectedAdminKey: null },
      { id: 3n, nickname: '全量复测070152', protectedAdminKey: null },
      { id: 4n, nickname: 'future-protected', protectedAdminKey: 'other-protected-key' },
    ];
    expect(selectIsolatedE2EUsers(users)).toEqual([users[1], users[2]]);
  });
});
