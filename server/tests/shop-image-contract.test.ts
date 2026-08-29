import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';
import { PERMISSION_KEYS } from '../src/permissions.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nkwAAAAASUVORK5CYII=', 'base64');

function multipart(name: string, mime: string, body: Buffer) {
  const boundary = '----dandan-shop-image-test';
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`),
      body,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

describe('shop image API contract', () => {
  let app: FastifyInstance;
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'dandan-shop-images-'));
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'disabled';
    process.env.SHOP_IMAGE_ROOT = root;
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60_000) } as never);
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({ id: 1n, protectedAdminKey: null, mustChangePassword: false } as never);
    vi.spyOn(prisma.userRoleGrant, 'findMany').mockResolvedValue([{
      startsAt: new Date(Date.now() - 60_000), expiresAt: null, revokedAt: null,
      role: { enabled: true, permissions: [{ permission: { key: PERMISSION_KEYS.shopProductCreateOwn } }] },
    }] as never);
  });

  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('validates, stores and publicly serves a product image', async () => {
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const form = multipart('product.png', 'image/png', png);

    const upload = await app.inject({ method: 'POST', url: '/api/shop/images', headers: { authorization: `Bearer ${token}`, 'content-type': form.contentType }, payload: form.body });

    expect(upload.statusCode).toBe(201);
    expect(upload.json().images).toHaveLength(1);
    expect(upload.json().images[0].url).toMatch(/^\/api\/shop\/images\/[a-f0-9-]+\.png$/);
    expect(await readdir(root)).toHaveLength(1);

    const image = await app.inject({ method: 'GET', url: upload.json().images[0].url });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toContain('image/png');
    expect(image.rawPayload.equals(png)).toBe(true);
  });

  it('rejects a file whose declared image type does not match its content', async () => {
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const form = multipart('product.png', 'image/png', Buffer.from('not an image'));
    const response = await app.inject({ method: 'POST', url: '/api/shop/images', headers: { authorization: `Bearer ${token}`, 'content-type': form.contentType }, payload: form.body });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('UNSUPPORTED_FILE_TYPE');
    expect(await readdir(root)).toEqual([]);
  });
});
