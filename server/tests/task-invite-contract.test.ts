import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const serverRoot = process.cwd();
const workspaceRoot = resolve(serverRoot, '..');
const appSource = readFileSync(resolve(serverRoot, 'src', 'app.ts'), 'utf8');
const profileSource = readFileSync(resolve(serverRoot, 'src', 'profile.ts'), 'utf8');
const apiClient = readFileSync(resolve(workspaceRoot, 'backend-handoff-package', 'api-client.js'), 'utf8');
const page = readFileSync(resolve(workspaceRoot, 'backend-handoff-package', 'growth-school.html'), 'utf8');

describe('task invite contract', () => {
  it('opens the server invite channel behind authentication', () => {
    expect(appSource).toContain("app.post('/api/task-invites'");
    expect(appSource).toContain('preHandler: app.authenticate');
    expect(appSource).toContain('prisma.notification.create');
    expect(appSource).toContain("type: 'invite'");
  });

  it('persists an invite notification and publishes a private realtime event', () => {
    expect(appSource).toContain('payload: { from: sender.nickname, fromId: userId.toString(), skills }');
    expect(appSource).toContain("realtimeEvent('task.invited'");
    expect(appSource).toContain('realtime.publishPrivate([input.targetUserId]');
  });

  it('validates skill count and blocks self-invites', () => {
    expect(appSource).toContain('.min(1).max(7)');
    expect(appSource).toContain('INVITE_SELF');
    expect(appSource).toContain('INVITE_SKILLS_REQUIRED');
  });

  it('limits profile skills to 7 server-side', () => {
    expect(profileSource).toContain('skills: z.array(profileTag).max(7).optional()');
  });

  it('wires the frontend to the real invite endpoint', () => {
    expect(apiClient).toContain('sendTaskInvite');
    expect(apiClient).toContain("'/api/task-invites'");
    expect(page).toContain('window.apiClient.sendTaskInvite');
    expect(page).not.toContain('服务端邀请通道暂未开放');
  });

  it('enforces a 7-skill cap in the skill picker UI', () => {
    expect(page).toContain('tempSkills.length >= 7');
    expect(page).toContain('技能标签最多选择 7 个');
    expect(page).toContain('window.apiClient.updateMe({ skills: tempSkills.slice() })');
  });
});
