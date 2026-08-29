import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), '..');
const host = readFileSync(resolve(root, 'backend-handoff-package', 'growth-school.html'), 'utf8');
const buddy = readFileSync(resolve(root, 'backend-handoff-package', 'blind-box', 'app.js'), 'utf8');

describe('frontend admin and interaction polish contract', () => {
  it('routes reward tasks to their dedicated plaza and leaves details available to guests', () => {
    expect(host).toContain("var type = task.taskType === 'help' || task.taskType === 'team' || task.taskType === 'reward' ? task.taskType : 'teach';");
    expect(host).toContain("reward:document.getElementById('rewardUserList')");
    expect(host).toContain('function bindDetailBtn(btn){');
    expect(host).toContain('showTaskDetail(btn);');
    expect(host).toContain("if(!USER.registered){ toast('请先登录后认领任务'); openLoginModal(); return; }");
  });

  it('uses an allowlisted admin avatar across task and feedback surfaces', () => {
    expect(host).toContain('var ADMIN_AVATAR_ASSETS =');
    expect(host).toContain('var adminAvatarPath = ADMIN_AVATAR_DEFAULT;');
    expect(host).toContain("window.apiClient.adminAvatar()");
    expect(host).toContain('data-admin-avatar');
    expect(host).toContain('adminAvatarMarkup(22)');
    expect(host).toContain("publisher && publisher.isAdministrator ? adminAvatarMarkup(30)");
  });

  it('keeps the profile edit entry below the identity area and hides invite code UI', () => {
    const profileTop = host.slice(host.indexOf('id="page-profile"'), host.indexOf('id="charSection"'));
    expect(profileTop).not.toContain('openProfileEditor()');
    expect(host).toContain('个人资料</h3><button class="btn btn-ghost btn-sm" onclick="openProfileEditor()">编辑资料</button>');
    const inviteModal = host.slice(host.indexOf('id="inviteModal"'), host.indexOf('id="ratingModal"'));
    expect(inviteModal).not.toContain('id="inviteCode"');
    expect(inviteModal).toContain('id="inviteLink"');
  });

  it('keeps school options as full-row buttons and preserves selected input', () => {
    expect(buddy).toContain('data-school="${name}"');
    expect(buddy).toContain("school.value = option.dataset.school === '__custom__' ? '' : option.dataset.school;");
    expect(buddy).toContain('school.focus();');
  });
});
