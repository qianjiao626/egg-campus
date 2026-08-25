import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('health endpoint', () => {
  let app: FastifyInstance;

  beforeAll(() => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    app = buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports the server as healthy without requiring a database query', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
