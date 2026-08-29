import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageRoot = resolve(process.cwd(), '..', 'backend-handoff-package');
const html = readFileSync(resolve(packageRoot, 'growth-school.html'), 'utf8');
const client = readFileSync(resolve(packageRoot, 'api-client.js'), 'utf8');
const sensitiveFilter = readFileSync(resolve(packageRoot, 'sensitive-filter.js'), 'utf8');

describe('frontend password reset contract', () => {
  it('exposes reset fields and calls the password reset API', () => {
    expect(html).toContain('id="forgotPasswordOverlay"');
    expect(html).toContain('id="resetTarget"');
    expect(html).toContain('id="resetCode"');
    expect(html).toContain('id="resetNewPassword"');
    expect(client).toContain("'/api/auth/password-reset/request'");
    expect(client).toContain("'/api/auth/password-reset/confirm'");
    expect(client).toContain('requestPasswordReset: function');
    expect(client).toContain('window.sendPasswordResetCode');
  });

  it('restores an HttpOnly cookie session after a page reload', () => {
    expect(client).toContain('restoreSession: async function');
    expect(client).toContain("'/api/auth/refresh'");
    expect(client).toContain("dandan:session-restored");
    expect(client).toContain("credentials: 'include'");
    expect(html).toContain('dandan:session-restored');
  });

  it('serializes protected requests behind the initial cookie-session restore', () => {
    expect(client).toContain('var sessionRestorePromise = new Promise');
    expect(client).toContain('await awaitSessionRestore();');
    expect(client).toContain('async function awaitSessionRestore()');
  });

  it('shares the parent session restore with the same-origin buddy-box iframe', () => {
    const buddyApi = readFileSync(resolve(packageRoot, 'blind-box', 'buddy-box-api.js'), 'utf8');

    expect(buddyApi).toContain('window.parent && window.parent !== window');
    expect(buddyApi).toContain('window.parent.apiClient');
    expect(buddyApi).toContain('window.parent.apiClient.getAccessToken()');
    expect(buddyApi).toContain('var refreshPromise = null;');
  });

  it('uses the server login endpoint for administrator sessions', () => {
    expect(html).toContain('onclick="doStudentLogin()"');
    expect(html).toContain('id="adminIdentifier"');
    expect(html).toContain('apiClient.login(identifier, pwd)');
    expect(html).not.toContain("pwd !== '123'");
    expect(client).toContain("'/api/auth/login'");
  });

  it('refreshes before server logout so expired or missing bearers do not emit a transient 401', () => {
    expect(client).toContain("request('/api/auth/logout', { method: 'POST' })");
    expect(client).toContain('var logoutRefresh = await apiClient.refresh();');
    expect(client).toContain('if (logoutRefresh && logoutRefresh.accessToken)');
  });

  it('does not persist credentials in browser storage', () => {
    expect(client).not.toMatch(/localStorage|sessionStorage/);
    expect(html).not.toMatch(/localStorage|sessionStorage/);
  });

  it('allows nickname/password registration without contact fields', () => {
    expect(client).toContain("if (!nick || !password || !confirm)");
    expect(client).not.toContain("document.getElementById('regPhone')");
    expect(client).not.toContain("document.getElementById('regCode')");
    expect(html).toContain('邮箱');
  });

  it('validates registration fields against the server contract before submitting', () => {
    expect(client).toContain("if (nick.length < 2 || nick.length > 50)");
    expect(client).toContain("if (password.length < 8 || password.length > 128)");
    expect(client).toContain("if (email && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email))");
    expect(client).toContain("if (ageText && (!Number.isInteger(age) || age < 13 || age > 100))");
    expect(html).toContain('id="regNickname" maxlength="50"');
    expect(html).toContain('id="regPwd" type="password" minlength="8" maxlength="128"');
    expect(html).toContain('id="regAge" type="number" min="13" max="100"');
    expect(html).toContain('id="regInviteCode"');
    expect(client).toContain("if (inviteCode && !/^[A-Z0-9]{6,20}$/.test(inviteCode))");
    expect(client).toContain('inviteCode: inviteCode || null');
    expect(html).toMatch(/<script src="api-client\.js\?v=[^"]+"><\/script>/);
  });

  it('keeps registration free of phone and verification-code fields', () => {
    expect(html).not.toContain('id="regPhone"');
    expect(html).not.toContain('id="regCode"');
    expect(html).not.toContain('sendRegistrationCode()');
    expect(client).not.toContain("document.getElementById('regPhone')");
    expect(client).not.toContain("document.getElementById('regCode')");
    expect(client).not.toContain("if (!regMbtiType) { toast('请选择 MBTI 类型'); return; }");
    expect(client).not.toContain("if (!regDrawResult) { toast('请先抽取你的初始蛋'); return; }");
  });

  it('removes phone login and SMS password-reset entry points', () => {
    expect(html).not.toContain('邮箱、手机号或昵称');
    expect(html).toContain('邮箱或昵称');
    expect(html).not.toContain('邮箱或 11 位手机号');
    expect(client).not.toContain("? 'sms' : 'email'");
    expect(client).not.toContain("channel, target, 'reset_password'");
  });

  it('uses the same bundled sensitive-word filter before every client write', () => {
    expect(html).toContain('src="sensitive-filter.js"');
    expect(client).toContain('window.DandanSensitiveFilter');
    expect(sensitiveFilter).toContain('诈骗');
    expect(sensitiveFilter).toContain('containsBlockedTerm');
  });
});

describe('blind-box persistence contract', () => {
  it('restores board and feature state from the current user records', () => {
    const client = readFileSync(resolve(packageRoot, 'blind-box', 'buddy-box-api.js'), 'utf8');
    const app = readFileSync(resolve(packageRoot, 'blind-box', 'app.js'), 'utf8');
    expect(client).toContain('getBoard: function');
    expect(client).toContain('getFeatureRecords: function');
    expect(app).toContain('syncBuddyBoard()');
    expect(app).toContain('syncBuddyFeatureState()');
    expect(app).toContain("record.feature");
  });
});

describe('my inquiries summary contract', () => {
  it('renders the server-provided reply summaries in the my inquiries panel', () => {
    expect(html).toContain('recentReplies');
    expect(html).toContain('replyCount');
    expect(html).toContain('我的打听回复');
  });

  it('keeps inquiry notification context for the notification panel', () => {
    expect(html).toContain('replyAuthorNickname');
    expect(html).toContain('inquiryTitle');
    expect(html).toContain('serverPayload');
    expect(html).toContain('showGossipDetail(Number(item.refId))');
  });
});

describe('real task publishing contract', () => {
  it('does not substitute development sample text for an empty published task', () => {
    expect(html).not.toContain("value.trim() || '教你做高数期中复习笔记'");
    expect(html).not.toContain("value.trim() || '分享学习经验，帮助学伴共同成长。'");
    expect(html).toContain("toast('请输入任务名称')");
    expect(html).toContain("toast('请输入任务描述')");
  });

  it('renders point transactions only from the server', () => {
    expect(html).toContain('apiClient.pointTransactions');
    expect(html).not.toContain('DEMO_POINT_LOGS');
    expect(html).not.toContain('DEMO_POINT_LOGS.concat(realRecords)');
  });

  it('does not use static claimed-task records for a newly registered user', () => {
    expect(html).toContain('apiClient.myTasks');
    expect(html).toContain('没有已认领的任务');
    expect(html).not.toMatch(/DB\.userTasks\[USER\.id\]/);
  });

  it('uses the server leaderboard instead of bundled placeholder users', () => {
    expect(client).toContain("'/api/users/leaderboard?category='");
    expect(html).toContain('apiClient.leaderboard');
    expect(html).not.toContain('var RANK_USERS = [');
  });
});

describe('invitation history contract', () => {
  it('renders the invitation endpoint fields instead of retired demo fields', () => {
    expect(html).toContain("i.status === 'rewarded'");
    expect(html).toContain('var invitedUser = i.invitedUser || {};');
    expect(html).toContain('invitedUser.createdAt');
    expect(html).not.toContain("i.status === 'done'");
  });
});

describe('profile, task hub and administrator UI contract', () => {
  it('offers one complete profile editor backed by PUT /api/users/me', () => {
    expect(html).toContain('id="profileEditModal"');
    expect(html).toContain('onclick="openProfileEditor()"');
    expect(html).toContain('id="profileEditNickname"');
    expect(html).toContain('id="profileEditInterests"');
    expect(html).toContain('id="profileEditSkills"');
    expect(html).toContain('昵称每 30 天只能修改一次');
    expect(client).toContain("updateMe: function");
    expect(client).toContain("request('/api/users/me', { method: 'PUT'");
  });

  it('refreshes the canonical authenticated user after a profile edit', () => {
    expect(html).toContain('var refreshedProfile = await window.apiClient.me()');
    expect(html).toContain('applyAuthenticatedUser(canonicalUser)');
  });

  it('synchronizes profile skill tags from the canonical user after profile hydration', () => {
    const refreshProfile = html.slice(html.indexOf('function refreshProfile()'), html.indexOf('var currentLogTab'));
    expect(refreshProfile).toContain('userSkills = Array.isArray(USER.skills) ? USER.skills.slice() : []');
  });

  it('consolidates published, claimed, inquiry and feedback history under My Tasks', () => {
    expect(html).toContain('data-task-hub="published"');
    expect(html).toContain('data-task-hub="claimed"');
    expect(html).toContain('data-task-hub="inquiries"');
    expect(html).toContain('data-task-hub="feedback"');
    expect(html).toContain("if(id === 'myinquiries')");
    expect(html).toContain("switchTaskHub('inquiries')");
    expect(html).toContain("if(id === 'myfeedback')");
    expect(html).toContain("switchTaskHub('feedback')");
    expect(html).not.toContain('data-page="myinquiries"');
    expect(html).not.toContain('data-page="myfeedback"');
  });

  it('keeps authorization separate from the current presentation mode', () => {
    expect(html).toContain('USER.isAdmin = Boolean(USER.isAdministrator)');
    expect(html).toContain("sessionAdminMode");
    expect(html).not.toContain("USER.points = 999999");
    expect(html).not.toContain("USER.nickname = '隐士蛋·蛋总'");
    expect(html).not.toContain("USER.role !== 'admin'");
  });

  it('does not ship a static administrator identity or infer identity from nickname text', () => {
    expect(html).not.toContain('id="adminSuperEgg"');
    expect(html).not.toContain('隐士蛋·蛋总');
    expect(html).not.toContain('六合一·UR');
    expect(html).not.toContain('function renderPubEggs(');
    expect(html).not.toContain('isAdminPub');
  });

  it('provides fine-grained role grants with inline descriptions and every duration option', () => {
    expect(html).toContain('data-page="permissions"');
    expect(html).toContain('id="page-permissions"');
    expect(html).toContain('id="permissionChecklist"');
    expect(html).toContain('1 小时');
    expect(html).toContain('7 天');
    expect(html).toContain('1 个月');
    expect(html).toContain('1 季度');
    expect(html).toContain('永久');
    expect(html).toContain('自定义');
    expect(html).toContain('高风险');
    expect(client).toContain("adminPermissions: function");
    expect(client).toContain("createRoleGrant: function");
  });

  it('shows a public administrator badge without exposing internal super-admin labels', () => {
    expect(html).toContain('class="administrator-badge"');
    expect(html).toContain('prefers-reduced-motion: reduce');
    expect(html).not.toContain('根管理员');
    expect(html).not.toContain('超级管理员');
  });

  it('uses empty-profile labels in administrator user details', () => {
    const userDetail = html.slice(html.indexOf('function showUserDetail(uid)'), html.indexOf('function closeUserDetail()'));

    expect(userDetail).toContain("u.school || '未填写学校'");
    expect(userDetail).toContain("u.major || '未填写专业'");
    expect(userDetail).toContain("u.grade || '未填写年级'");
  });
});
