const ISOLATED_DATABASE_NAME = 'dandan_campus_test';
const ISOLATED_ADMIN_IDENTIFIER = 'isolated-e2e-admin';

export interface IsolatedE2EBootstrapInput {
  databaseUrl: string;
  identifier: string;
  password: string;
}

export interface IsolatedE2EBootstrapResult {
  databaseName: string;
  identifier: string;
}

export function validateIsolatedE2EBootstrapInput(input: IsolatedE2EBootstrapInput): IsolatedE2EBootstrapResult {
  let databaseName: string;
  try {
    databaseName = new URL(input.databaseUrl).pathname.replace(/^\//, '');
  } catch {
    throw new Error('INVALID_DATABASE_URL');
  }
  if (databaseName !== ISOLATED_DATABASE_NAME) throw new Error('ISOLATED_TEST_DATABASE_REQUIRED');
  if (input.identifier !== ISOLATED_ADMIN_IDENTIFIER) throw new Error('INVALID_E2E_ADMIN_IDENTIFIER');
  if (typeof input.password !== 'string' || input.password.length < 16) throw new Error('INVALID_E2E_ADMIN_PASSWORD');
  return { databaseName, identifier: input.identifier };
}
