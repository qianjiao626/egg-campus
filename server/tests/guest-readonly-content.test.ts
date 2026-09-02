import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/prisma.js';

const frontend = readFileSync(resolve(process.cwd(), '..', 'backend-handoff-package', 'growth-school.html'), 'utf8');

describe('guest read-only content', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
    process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
    app = buildApp();
    vi.spyOn(prisma.task, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.inquiry, 'findMany').mockResolvedValue([]);
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('serves public tasks and inquiries without an authenticated session', async () => {
    const tasks = await app.inject({ method: 'GET', url: '/api/tasks' });
    const inquiries = await app.inject({ method: 'GET', url: '/api/inquiries' });

    expect(tasks.statusCode).toBe(200);
    expect(tasks.json()).toEqual({ tasks: [] });
    expect(inquiries.statusCode).toBe(200);
    expect(inquiries.json()).toEqual({ inquiries: [] });
  });

  it('keeps public guest navigation and disables public-page action buttons', () => {
    expect(frontend).toContain("var GUEST_PUBLIC_PAGES = ['plaza','helpplaza','teamplaza','rankhall','gossip','blacklist'];");
    expect(frontend).toContain('function applyGuestReadOnlyState()');
    expect(frontend).toContain('body.classList.toggle(\'guest-readonly\', !USER.registered)');
    expect(frontend).toContain('syncPublicTaskPlazas();');
    expect(frontend).toContain('syncGossipInquiries(true);');
    expect(frontend).toContain("if(!window.apiClient || typeof window.apiClient.publicTasks !== 'function') return;");
    expect(frontend).toContain("if(!window.apiClient || !window.apiClient.inquiries) return;");
  });
});
