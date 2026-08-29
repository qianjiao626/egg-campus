import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nkwAAAAASUVORK5CYII=', 'base64');

function multipart(files: Array<{ name: string; mime: string; body: Buffer }>) {
  const boundary = '----dandan-feedback-test';
  const chunks: Buffer[] = [];
  for (const file of files) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`));
    chunks.push(file.body, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe('feedback attachment API contract', () => {
  let app: FastifyInstance;
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'dandan-feedback-'));
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    process.env.VERIFICATION_PROVIDER = 'mock';
    process.env.FEEDBACK_ATTACHMENT_ROOT = root;
    app = buildApp();
    await app.ready();
    vi.spyOn(prisma.authSession, 'findUnique').mockResolvedValue({ id: 'session', userId: 1n, revokedAt: null, expiresAt: new Date(Date.now() + 60000) } as never);
  });

  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('stores a valid image outside public assets and returns metadata only', async () => {
    vi.spyOn(prisma.feedback, 'findUnique').mockResolvedValue({ id: 7n, userId: 1n, status: 'needs_changes' } as never);
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback({
      feedbackAttachment: {
        create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: 30n, createdAt: new Date(), hiddenAt: null, ...data })),
      },
    }) as never);
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const form = multipart([{ name: 'screen.png', mime: 'image/png', body: png }]);
    const response = await app.inject({ method: 'POST', url: '/api/feedback/7/attachments', headers: { authorization: `Bearer ${token}`, 'content-type': form.contentType }, payload: form.body });
    expect(response.statusCode).toBe(201);
    expect(response.json().attachments[0]).toMatchObject({ id: '30', originalName: 'screen.png', mimeType: 'image/png' });
    expect(response.body).not.toContain('storageKey');
    expect(await readdir(root)).toHaveLength(1);
  });

  it('rejects a fourth file without persisting any attachment', async () => {
    vi.spyOn(prisma.feedback, 'findUnique').mockResolvedValue({ id: 7n, userId: 1n, status: 'needs_changes' } as never);
    const transaction = vi.spyOn(prisma, '$transaction');
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const form = multipart(Array.from({ length: 4 }, (_, index) => ({ name: `screen-${index}.png`, mime: 'image/png', body: png })));
    const response = await app.inject({ method: 'POST', url: '/api/feedback/7/attachments', headers: { authorization: `Bearer ${token}`, 'content-type': form.contentType }, payload: form.body });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('TOO_MANY_ATTACHMENTS');
    expect(transaction).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });

  it('blocks cross-user reads and treats hidden files as unavailable', async () => {
    vi.spyOn(prisma.feedbackAttachment, 'findUnique').mockResolvedValue({ id: 30n, feedbackId: 7n, storageKey: '00000000-0000-0000-0000-000000000000.png', originalName: 'screen.png', mimeType: 'image/png', hiddenAt: null, feedback: { userId: 2n } } as never);
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({ protectedAdminKey: null, mustChangePassword: false } as never);
    vi.spyOn(prisma.userRoleGrant, 'findMany').mockResolvedValue([]);
    const token = await app.jwt.sign({ sub: '1', sessionId: 'session', role: 'student' });
    const forbidden = await app.inject({ method: 'GET', url: '/api/feedback/7/attachments/30', headers: { authorization: `Bearer ${token}` } });
    expect(forbidden.statusCode).toBe(403);

    vi.mocked(prisma.feedbackAttachment.findUnique).mockResolvedValueOnce({ id: 30n, feedbackId: 7n, storageKey: '00000000-0000-0000-0000-000000000000.png', originalName: 'screen.png', mimeType: 'image/png', hiddenAt: new Date(), feedback: { userId: 1n } } as never);
    const hidden = await app.inject({ method: 'GET', url: '/api/feedback/7/attachments/30', headers: { authorization: `Bearer ${token}` } });
    expect(hidden.statusCode).toBe(410);
    expect(hidden.json().error).toBe('ATTACHMENT_HIDDEN');
  });
});
