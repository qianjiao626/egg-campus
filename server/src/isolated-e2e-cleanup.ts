export const ISOLATED_E2E_DATABASE_NAME = 'dandan_campus_test';
export const ISOLATED_E2E_ADMIN_IDENTIFIER = 'isolated-e2e-admin';

export interface IsolatedCleanupUser {
  id: bigint;
  nickname: string;
  protectedAdminKey: string | null;
}

export function assertIsolatedCleanupDatabase(databaseUrl: string): void {
  let databaseName: string;
  try {
    databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');
  } catch {
    throw new Error('INVALID_DATABASE_URL');
  }
  if (databaseName !== ISOLATED_E2E_DATABASE_NAME) throw new Error('ISOLATED_TEST_DATABASE_REQUIRED');
}

export function selectIsolatedE2EUsers(users: readonly IsolatedCleanupUser[]): IsolatedCleanupUser[] {
  return users.filter((user) => user.nickname !== ISOLATED_E2E_ADMIN_IDENTIFIER && user.protectedAdminKey === null);
}

export function assertProtectedIsolatedAdmin(users: readonly IsolatedCleanupUser[]): void {
  const admins = users.filter((user) => user.nickname === ISOLATED_E2E_ADMIN_IDENTIFIER);
  if (admins.length !== 1 || admins[0].protectedAdminKey !== ISOLATED_E2E_ADMIN_IDENTIFIER) {
    throw new Error('ISOLATED_E2E_ADMIN_REQUIRED');
  }
}
