import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
process.env.VERIFICATION_PROVIDER = 'mock';

describe('realtime websocket route', () => {
  let app: FastifyInstance | undefined;
  let client: WebSocket | undefined;

  afterEach(async () => {
    client?.close();
    await app?.close();
    client = undefined;
    app = undefined;
    vi.restoreAllMocks();
  });

  it('rejects an unauthenticated websocket upgrade', async () => {
    app = buildApp();
    await app.ready();

    await expect(app.injectWS('/api/realtime')).rejects.toThrow();
  });

  it('does not write query-string access tokens to request logs', () => {
    const source = readFileSync(resolve(process.cwd(), 'src', 'app.ts'), 'utf8');
    const routeStart = source.indexOf("instance.get('/api/realtime'");
    const routeEnd = source.indexOf('preValidation: instance.authenticate', routeStart);

    expect(routeStart).toBeGreaterThan(-1);
    expect(source.slice(routeStart, routeEnd)).toContain("logLevel: 'silent'");
  });

  it('accepts a valid session token and delivers private events', async () => {
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({
      id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60_000),
    } as never);
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });

    client = await app.injectWS('/api/realtime?token=' + encodeURIComponent(token));
    const received = new Promise<Record<string, unknown>>((resolve) => {
      client?.once('message', (payload) => resolve(JSON.parse(payload.toString())));
    });
    app.realtime.publishPrivate([1n], {
      type: 'task.reviewed', resourceId: '42', scope: 'private', occurredAt: '2026-08-27T00:00:00.000Z',
    });

    await expect(received).resolves.toMatchObject({ type: 'task.reviewed', scope: 'private' });
  });
});
