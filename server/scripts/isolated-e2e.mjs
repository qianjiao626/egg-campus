import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const BASE_URL = 'http://127.0.0.1:13311';
const WS_URL = 'ws://127.0.0.1:13311/api/realtime';
const REPORT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/online-test-reports/2026-08-27-isolated-e2e.md');
const adminIdentifier = process.env.E2E_ADMIN_IDENTIFIER;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;

if (BASE_URL !== 'http://127.0.0.1:13311' || WS_URL !== 'ws://127.0.0.1:13311/api/realtime') {
  throw new Error('隔离 E2E 只能连接本机 13311 SSH 隧道');
}
if (!adminIdentifier || !adminPassword) {
  throw new Error('缺少 E2E_ADMIN_IDENTIFIER 或 E2E_ADMIN_PASSWORD');
}

const results = [];
const sockets = [];
const stamp = `${Date.now()}`.slice(-10);

function summarize(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, (key, item) => {
    if (/password|token|cookie/i.test(key)) return '[REDACTED]';
    return item;
  });
  return text.length > 280 ? `${text.slice(0, 280)}...` : text;
}

async function request(path, { method = 'GET', token, body, cookie, expected = 200 } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (![].concat(expected).includes(response.status)) {
    throw new Error(`${method} ${path} -> ${response.status}: ${summarize(data)}`);
  }
  return { status: response.status, data, setCookie: response.headers.get('set-cookie') };
}

async function login(identifier, password) {
  const response = await request('/api/auth/login', { method: 'POST', body: { identifier, password } });
  return {
    user: response.data.user,
    token: response.data.accessToken,
    refreshCookie: response.setCookie?.split(';')[0] ?? '',
  };
}

async function register(nickname, extra = {}) {
  const response = await request('/api/auth/register', {
    method: 'POST',
    expected: 201,
    body: { nickname, password: `E2E-${stamp}-Pass!`, ...extra },
  });
  return {
    nickname,
    password: `E2E-${stamp}-Pass!`,
    user: response.data.user,
    token: response.data.accessToken,
    refreshCookie: response.setCookie?.split(';')[0] ?? '',
  };
}

function connectSocket(token) {
  const events = [];
  const socket = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
  sockets.push(socket);
  const opened = new Promise((resolveOpen, reject) => {
    socket.once('open', resolveOpen);
    socket.once('error', reject);
  });
  socket.on('message', (payload) => {
    try { events.push(JSON.parse(payload.toString())); } catch { /* invalid events fail via timeout */ }
  });
  return {
    socket,
    opened,
    async waitFor(predicate, label, timeoutMs = 4000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const event = events.find(predicate);
        if (event) return event;
        await new Promise((resolveWait) => setTimeout(resolveWait, 40));
      }
      throw new Error(`未收到 WebSocket 事件: ${label}; 已收到 ${summarize(events)}`);
    },
  };
}

async function check(name, expected, operation) {
  const startedAt = new Date().toISOString();
  try {
    const actual = await operation();
    results.push({ startedAt, name, expected, actual: summarize(actual ?? '通过'), passed: true, problem: '' });
    return actual;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ startedAt, name, expected, actual: message, passed: false, problem: message });
    throw error;
  }
}

function markdownReport() {
  const rows = results.map((item) => `| ${item.startedAt} | ${item.name} | ${item.expected} | ${String(item.actual).replaceAll('|', '\\|')} | ${item.passed ? '通过' : '失败'} | ${String(item.problem).replaceAll('|', '\\|')} |`);
  return [
    '# 蛋蛋校园隔离数据库 E2E 测试报告',
    '',
    `- 测试目标：\`${BASE_URL}\`（SSH 隧道后的隔离测试服务）`,
    `- 生成时间：${new Date().toISOString()}`,
    '- 说明：测试记录仅写入隔离库并在启动器前后清理；未连接生产数据库。',
    '',
    '| 测试时间 | 用例项 | 预期结果 | 实际结果 | 是否通过 | 问题简述 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

let exitCode = 0;
try {
  const health = await check('服务健康检查', '返回 200 与 status=ok', async () => {
    const response = await request('/health');
    assert.equal(response.data.status, 'ok');
    return response.data;
  });
  assert.equal(health.status, 'ok');

  const admin = await check('隔离管理员登录及权限', '管理员身份有效且拥有 task.review', async () => {
    const session = await login(adminIdentifier, adminPassword);
    const me = await request('/api/users/me', { token: session.token });
    assert.equal(me.data.user.isAdministrator, true);
    assert.ok(me.data.user.permissionKeys.includes('task.review'));
    return session;
  });

  const inviter = await check('注册邀请人', '昵称密码注册成功并获得邀请码', async () => {
    const session = await register(`验收甲${stamp}`);
    assert.ok(session.user.inviteCode);
    return session;
  });
  const invitee = await check('邀请码注册受邀用户', '有效邀请码绑定成功', async () => {
    const session = await register(`验收乙${stamp}`, { inviteCode: inviter.user.inviteCode });
    assert.ok(session.user.id);
    return session;
  });
  const helper = await check('注册跨用户验收账号', '第三个隔离账号注册成功', async () => register(`验收丙${stamp}`));

  await check('Cookie 刷新与登录恢复', 'refresh 轮换 Cookie，新 accessToken 可读取 /me', async () => {
    assert.ok(invitee.refreshCookie.startsWith('dandan_refresh='));
    const refresh = await request('/api/auth/refresh', { method: 'POST', cookie: invitee.refreshCookie });
    assert.ok(refresh.data.accessToken);
    assert.ok(refresh.setCookie?.includes('dandan_refresh='));
    const me = await request('/api/users/me', { token: refresh.data.accessToken });
    assert.equal(me.data.user.id, invitee.user.id);
    invitee.token = refresh.data.accessToken;
    return { userId: me.data.user.id, cookieRotated: refresh.setCookie !== invitee.refreshCookie };
  });

  await check('个人资料首次编辑与持久化', '学校、专业、兴趣、技能写库并在刷新查询后保留', async () => {
    await request('/api/users/me', {
      method: 'PUT', token: invitee.token,
      body: { school: '南京验收大学', major: '软件工程', interests: ['摄影'], skills: ['TypeScript'] },
    });
    const me = await request('/api/users/me', { token: invitee.token });
    assert.deepEqual(me.data.user.interests, ['摄影']);
    assert.deepEqual(me.data.user.skills, ['TypeScript']);
    return { school: me.data.user.school, interests: me.data.user.interests, skills: me.data.user.skills };
  });

  await check('个人资料二次编辑与持久化', '第二次编辑城市、简介、兴趣、技能后刷新不丢失', async () => {
    await request('/api/users/me', {
      method: 'PUT', token: invitee.token,
      body: { city: '南京', bio: '[demo] 二次编辑资料', interests: ['摄影', '跑步'], skills: ['Node.js'] },
    });
    const me = await request('/api/users/me', { token: invitee.token });
    assert.equal(me.data.user.city, '南京');
    assert.deepEqual(me.data.user.interests, ['摄影', '跑步']);
    assert.deepEqual(me.data.user.skills, ['Node.js']);
    return { city: me.data.user.city, interests: me.data.user.interests, skills: me.data.user.skills };
  });

  const adminWs = connectSocket(admin.token);
  const ownerWs = connectSocket(invitee.token);
  const helperWs = connectSocket(helper.token);
  await Promise.all([adminWs.opened, ownerWs.opened, helperWs.opened]);

  const task = await check('发布带技能标签任务', '任务进入待审核且技能字段入库', async () => {
    const created = await request('/api/tasks', {
      method: 'POST', expected: 201, token: invitee.token,
      body: { title: `[demo] 持久化任务${stamp}`, description: '验证跨用户可见与接取持久化', taskType: 'help', reward: 0, skillCategory: '软件开发', skillSubcategory: 'TypeScript' },
    });
    assert.equal(created.data.task.status, 'pending_review');
    assert.equal(created.data.task.skillSubcategory, 'TypeScript');
    await adminWs.waitFor((event) => event.type === 'task.pending' && event.resourceId === created.data.task.id && event.scope === 'admin', '管理员 task.pending');
    return created.data.task;
  });

  await check('管理员待审核任务可见', '非发布者管理员可读取任务', async () => {
    const queue = await request('/api/admin/tasks/review-queue', { token: admin.token });
    assert.ok(queue.data.tasks.some((item) => item.id === task.id));
    return { taskId: task.id };
  });

  await check('任务退回修改与技能标签更新', '发布者修改技能后重新进入待审核并持久化', async () => {
    await request(`/api/tasks/${task.id}/review`, { method: 'PATCH', token: admin.token, body: { status: 'needs_revision', reviewReason: '验收技能标签编辑' } });
    const updated = await request(`/api/tasks/${task.id}`, { method: 'PATCH', token: invitee.token, body: { skillCategory: '后端开发', skillSubcategory: 'Node.js' } });
    assert.equal(updated.data.task.skillCategory, '后端开发');
    assert.equal(updated.data.task.skillSubcategory, 'Node.js');
    const mine = await request('/api/tasks/mine?status=pending_review', { token: invitee.token });
    const persisted = mine.data.tasks.find((item) => item.id === task.id);
    assert.equal(persisted.skillSubcategory, 'Node.js');
    return { skillCategory: persisted.skillCategory, skillSubcategory: persisted.skillSubcategory };
  });

  await check('审核公开与跨用户可见', '审核通过后其他合法用户可见，并收到公共/私有实时事件', async () => {
    await request(`/api/tasks/${task.id}/review`, { method: 'PATCH', token: admin.token, body: { status: 'approved' } });
    const publicEvent = await helperWs.waitFor((event) => event.type === 'task.approved' && event.resourceId === task.id && event.scope === 'public', '公共 task.approved');
    const privateEvent = await ownerWs.waitFor((event) => event.type === 'task.reviewed' && event.resourceId === task.id && event.scope === 'private', '发布者 task.reviewed');
    const list = await request('/api/tasks', { token: helper.token });
    const visible = list.data.tasks.find((item) => item.id === task.id);
    assert.equal(visible.skillSubcategory, 'Node.js');
    return { publicEvent, privateEvent, visible: true };
  });

  await check('任务接取与放弃持久化', '接取人数刷新为 1，放弃后刷新为 0', async () => {
    await request(`/api/tasks/${task.id}/claim`, { method: 'POST', expected: 201, token: helper.token, body: { contact: 'isolated-e2e' } });
    let list = await request('/api/tasks', { token: helper.token });
    assert.equal(list.data.tasks.find((item) => item.id === task.id).activeClaimCount, 1);
    await request(`/api/tasks/${task.id}/abandon`, { method: 'POST', token: helper.token, body: {} });
    list = await request('/api/tasks', { token: helper.token });
    assert.equal(list.data.tasks.find((item) => item.id === task.id).activeClaimCount, 0);
    return { beforeAbandon: 1, afterAbandon: 0 };
  });

  await check('教学任务协商取消持久化', '双方协商后任务和认领取消，冻结的蛋蛋币恢复', async () => {
    const created = await request('/api/tasks', {
      method: 'POST', expected: 201, token: invitee.token,
      body: { title: `[demo] 协商取消任务${stamp}`, description: '验证协商取消和冻结蛋蛋币返还', taskType: 'teach', reward: 5, skillCategory: '后端开发', skillSubcategory: 'Node.js' },
    });
    await request(`/api/tasks/${created.data.task.id}/review`, { method: 'PATCH', token: admin.token, body: { status: 'approved' } });
    const beforeClaim = await request('/api/users/me/point-account', { token: helper.token });
    const claim = await request(`/api/tasks/${created.data.task.id}/claim`, { method: 'POST', expected: 201, token: helper.token, body: { contact: 'isolated-cancellation' } });
    await request(`/api/tasks/${created.data.task.id}/claims/assign`, { method: 'PATCH', token: invitee.token, body: { claimIds: [claim.data.claim.id] } });
    const requested = await request(`/api/tasks/${created.data.task.id}/cancellation-requests`, { method: 'POST', expected: 201, token: helper.token, body: { reason: '验收协商取消' } });
    const pending = await request('/api/tasks/cancellation-requests/mine', { token: invitee.token });
    assert.ok(pending.data.requests.some((item) => item.id === requested.data.request.id && item.status === 'pending'));
    await request(`/api/tasks/${created.data.task.id}/cancellation-requests/${requested.data.request.id}/respond`, { method: 'POST', token: invitee.token, body: { status: 'accepted' } });
    const afterClaim = await request('/api/users/me/point-account', { token: helper.token });
    assert.equal(afterClaim.data.account.availableBalance, beforeClaim.data.account.availableBalance);
    const ownerTasks = await request('/api/tasks/mine', { token: invitee.token });
    const claimedTasks = await request('/api/tasks/claimed', { token: helper.token });
    assert.equal(ownerTasks.data.tasks.find((item) => item.id === created.data.task.id).status, 'cancelled');
    assert.equal(claimedTasks.data.claims.find((item) => item.task.id === created.data.task.id).status, 'cancelled');
    return { taskId: created.data.task.id, requestId: requested.data.request.id, balanceRestored: true };
  });

  await check('邀请码首次审核任务奖励', '邀请关系标记 rewarded，邀请人增加 20 蛋蛋币', async () => {
    const invitations = await request('/api/users/me/invitations', { token: inviter.token });
    assert.ok(invitations.data.invitations.some((item) => item.invitedUser.id === invitee.user.id && item.status === 'rewarded'));
    assert.equal(invitations.data.totalReward, 20);
    const account = await request('/api/users/me/point-account', { token: inviter.token });
    assert.equal(account.data.account.availableBalance, 120);
    return { rewardedCount: invitations.data.rewardedCount, balance: account.data.account.availableBalance };
  });

  await check('邀请发布任务接口与通知持久化', '邀请他人发布任务成功并写入对方通知，自邀与超 7 个技能被拒绝', async () => {
    const created = await request('/api/task-invites', {
      method: 'POST', expected: 201, token: helper.token,
      body: { targetUserId: inviter.user.id, skills: ['前端开发', '设计'] },
    });
    assert.equal(created.data.invited, true);
    assert.ok(String(created.data.notificationId).length > 0);

    const notifications = await request('/api/notifications/unread', { token: inviter.token });
    assert.ok(notifications.data.notifications.some((item) => item.type === 'invite' && Array.isArray(item.payload?.skills) && item.payload.skills.includes('前端开发')));

    const selfInvite = await request('/api/task-invites', {
      method: 'POST', expected: 400, token: helper.token,
      body: { targetUserId: helper.user.id, skills: ['前端开发'] },
    });
    assert.equal(selfInvite.data.error, 'INVITE_SELF');

    const tooMany = await request('/api/task-invites', {
      method: 'POST', expected: 400, token: helper.token,
      body: { targetUserId: inviter.user.id, skills: ['1', '2', '3', '4', '5', '6', '7', '8'] },
    });
    assert.equal(tooMany.data.error, 'VALIDATION_ERROR');

    return { invited: created.data.invited, notificationId: created.data.notificationId };
  });

  await check('技能标签上限 7 个', '提交 8 个技能被后端拒绝', async () => {
    const rejected = await request('/api/users/me', {
      method: 'PUT', expected: 400, token: helper.token,
      body: { skills: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] },
    });
    assert.equal(rejected.data.error, 'VALIDATION_ERROR');
    return { error: rejected.data.error };
  });

  const inquiry = await check('打听发布与公共实时事件', '打听写库并实时通知在线用户', async () => {
    const created = await request('/api/inquiries', { method: 'POST', expected: 201, token: inviter.token, body: { title: `[demo] 校园打听${stamp}`, content: '图书馆开放时间是什么？', tags: ['校园'], bounty: 0 } });
    await helperWs.waitFor((event) => event.type === 'inquiry.created' && event.resourceId === created.data.inquiry.id && event.scope === 'public', '公共 inquiry.created');
    return created.data.inquiry;
  });

  const inquiryReply = await check('打听回复、点赞与列表刷新', '回答写库，点赞状态和数量由后端返回', async () => {
    const reply = await request(`/api/inquiries/${inquiry.id}/replies`, { method: 'POST', expected: 201, token: helper.token, body: { content: '晚上十点闭馆', kind: 'answer' } });
    const liked = await request(`/api/inquiries/${inquiry.id}/like`, { method: 'POST', token: helper.token, body: {} });
    assert.equal(liked.data.liked, true);
    const replies = await request(`/api/inquiries/${inquiry.id}/replies`, { token: inviter.token });
    assert.ok(replies.data.replies.some((item) => item.id === reply.data.reply.id));
    return reply.data.reply;
  });

  await check('打听采纳持久化', '提问者可采纳回答，刷新后状态保留', async () => {
    await request(`/api/inquiries/${inquiry.id}/adopt/${inquiryReply.id}`, { method: 'POST', token: inviter.token, body: {} });
    const mine = await request('/api/inquiries/mine', { token: inviter.token });
    const persisted = mine.data.inquiries.find((item) => item.id === inquiry.id);
    assert.equal(persisted.adopted, true);
    assert.equal(persisted.adoptedReplyId, inquiryReply.id);
    return { adopted: persisted.adopted, adoptedReplyId: persisted.adoptedReplyId };
  });

  await check('盲盒偏好、投放、抽取与推荐', '偏好和玩法记录持久化，推荐包含匹配用户，抽取消耗 1 蛋蛋币', async () => {
    await request('/api/buddy-box/preferences', { method: 'PUT', token: inviter.token, body: { mbtiType: 'INTP', hobbies: ['摄影'], todayActions: ['一起自习'], province: '江苏省', city: '南京市', district: '鼓楼区' } });
    await request('/api/buddy-box/preferences', { method: 'PUT', token: helper.token, body: { mbtiType: 'INTP', hobbies: ['摄影'], todayActions: ['一起自习'], province: '江苏省', city: '南京市', district: '鼓楼区' } });
    await request('/api/buddy-box/features', { method: 'POST', expected: 201, token: inviter.token, body: { feature: 'box', action: 'put', payload: { thought: '[demo] 今天想一起自习' }, idempotencyKey: `put-${stamp}` } });
    const draw = await request('/api/buddy-box/features', { method: 'POST', expected: 201, token: helper.token, body: { feature: 'box', action: 'draw', payload: { actionPool: ['一起自习'] }, idempotencyKey: `draw-${stamp}` } });
    assert.equal(draw.data.record.result.availablePrestige, 99);
    const recommendations = await request('/api/buddy-box/recommendations?action=%E4%B8%80%E8%B5%B7%E8%87%AA%E4%B9%A0', { token: helper.token });
    assert.ok(recommendations.data.profiles.some((profile) => profile.id === inviter.user.id));
    const records = await request('/api/buddy-box/features?scope=mine&limit=100', { token: helper.token });
    assert.ok(records.data.records.some((record) => record.action === 'draw'));
    return { availablePrestige: draw.data.record.result.availablePrestige, recommended: true };
  });

  const friendRequest = await check('好友申请去重与聊天前置权限', '未接受时禁止聊天，重复待处理请求被拒绝', async () => {
    const created = await request('/api/buddy-box/friend-requests', { method: 'POST', token: helper.token, body: { recipientId: inviter.user.id } });
    await request('/api/buddy-box/messages', { method: 'POST', expected: 403, token: helper.token, body: { recipientId: inviter.user.id, text: '接受前不应发送' } });
    const duplicate = await request('/api/buddy-box/friend-requests', { method: 'POST', expected: 409, token: helper.token, body: { recipientId: inviter.user.id } });
    assert.equal(duplicate.data.error, 'REQUEST_PENDING');
    return created.data.request;
  });

  await check('接受好友后聊天与私有实时事件', '接受后双方可聊天，消息仅向相关用户实时推送', async () => {
    await request(`/api/buddy-box/friend-requests/${friendRequest.id}/accept`, { method: 'POST', token: inviter.token, body: {} });
    const sent = await request('/api/buddy-box/messages', { method: 'POST', token: helper.token, body: { recipientId: inviter.user.id, text: '[demo] 好友消息' } });
    const event = await helperWs.waitFor((item) => item.type === 'buddy.message.created' && item.resourceId === sent.data.message.id && item.scope === 'private', '私有 buddy.message.created');
    const conversation = await request(`/api/buddy-box/conversations/${helper.user.id}/messages`, { token: inviter.token });
    assert.ok(conversation.data.messages.some((item) => item.id === sent.data.message.id));
    const alreadyFriend = await request('/api/buddy-box/friend-requests', { method: 'POST', expected: 409, token: helper.token, body: { recipientId: inviter.user.id } });
    assert.equal(alreadyFriend.data.error, 'FRIEND_EXISTS');
    return event;
  });

  await check('声望排行榜动态数据', '排行榜从真实注册用户与持久化分值生成', async () => {
    const leaderboard = await request('/api/users/leaderboard?category=all');
    const users = leaderboard.data.users ?? leaderboard.data.leaderboard ?? [];
    assert.ok(users.some((item) => String(item.id) === String(inviter.user.id)));
    return { entries: users.length };
  });

  await check('WebSocket 断线后的 REST 兜底', '关闭实时连接后 REST 仍可拉取完整业务数据', async () => {
    helperWs.socket.close(1000, 'e2e fallback');
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    const tasks = await request('/api/tasks', { token: helper.token });
    const inquiries = await request('/api/inquiries', { token: helper.token });
    assert.ok(tasks.data.tasks.some((item) => item.id === task.id));
    assert.ok(inquiries.data.inquiries.some((item) => item.id === inquiry.id));
    return { tasksFallback: true, inquiriesFallback: true };
  });
} catch (error) {
  exitCode = 1;
  console.error(error instanceof Error ? error.message : error);
} finally {
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  }
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, markdownReport(), 'utf8');
  console.log(`E2E_REPORT=${REPORT_PATH}`);
  console.log(`E2E_RESULT=${results.filter((item) => item.passed).length}/${results.length}`);
}

process.exitCode = exitCode;
