import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageRoot = resolve(process.cwd(), '..', 'backend-handoff-package');
const html = readFileSync(resolve(packageRoot, 'growth-school.html'), 'utf8');
const apiClient = readFileSync(resolve(packageRoot, 'api-client.js'), 'utf8');
const blindBoxApp = readFileSync(resolve(packageRoot, 'blind-box', 'app.js'), 'utf8');

describe('production frontend data contract', () => {
  it('does not ship demo task, point, inquiry, rating, or user records', () => {
    expect(html).not.toContain('data-demo="true"');
    expect(html).not.toContain('DEMO_POINT_LOGS');
    expect(html).not.toContain('DEMO_GOSSIP_POSTS');
    expect(html).not.toMatch(/\bvar\s+USER_DB\s*=/);
    expect(html).not.toMatch(/\bvar\s+DB\s*=/);
    expect(html).not.toMatch(/\bvar\s+TASK_CLAIMERS\s*=/);
    expect(html).not.toMatch(/\bvar\s+ratings\s*=\s*\[/);
    for (const bundledIdentity of ['张小雨', '赵明', '李昊', '陈思远', '老学长', '学姐在摸鱼']) {
      expect(html).not.toContain(bundledIdentity);
    }
    for (const blindBoxIdentity of ['林深', '小满', '周周', '阿遥', '咕噜', '柚子']) {
      expect(blindBoxApp).not.toContain(blindBoxIdentity);
    }
    expect(html).not.toContain('开发演示用户资料');
    expect(html).not.toContain('演示任务');
    expect(html).not.toContain('tag-demo');
    expect(html).not.toContain('demo-row');
    expect(html).not.toMatch(/\bdemo\s*:/);
    expect(html).not.toMatch(/\.demo\b/);
    expect(html).not.toContain('id="adminSuperEgg"');
    expect(html).not.toContain('隐士蛋·蛋总');
    expect(html).not.toContain('六合一·UR');
    expect(html).not.toContain("reputation: USER.stats.reputation || 5.0");
    expect(html).not.toContain("egg: CHAR_STATE.current || '学业技术'");
  });

  it('does not merge server records with bundled demo records', () => {
    expect(html).not.toMatch(/DEMO_POINT_LOGS\.(?:concat|slice)/);
    expect(html).not.toMatch(/DEMO_GOSSIP_POSTS\.(?:concat|slice|forEach)/);
    expect(html).not.toMatch(/demoPosts\.concat\(mapped\)/);
    expect(html).not.toMatch(/pointLogs\.(?:push|unshift|splice)\(/);
    expect(html).not.toMatch(/expLogs\.(?:push|unshift|splice)\(/);
    expect(html).not.toMatch(/USER\.(?:points|eggCoins)\s*[+-]=/);
  });

  it('initializes an empty inquiry cache before rendering real API records', () => {
    expect(html).toContain('var GOSSIP_POSTS = [];');
    expect(html.indexOf('var GOSSIP_POSTS = [];')).toBeLessThan(html.indexOf('renderGossipWall();'));
    expect(html).toMatch(/GOSSIP_POSTS\.length = 0;[\s\S]*?push\.apply\(GOSSIP_POSTS, mapped\)/);
  });

  it('initializes inquiry UI state before the first wall render', () => {
    expect(html).toContain("var currentGossipCat = 'all';");
    expect(html).toContain('var currentGossipDetail = null;');
    expect(html.indexOf("var currentGossipCat = 'all';")).toBeLessThan(html.indexOf('renderGossipWall();'));
    expect(html.indexOf('var currentGossipDetail = null;')).toBeLessThan(html.indexOf('renderGossipWall();'));
  });

  it('does not fabricate invite codes, profiles, or publisher stats', () => {
    expect(html).not.toContain('EGG00001');
    expect(html).not.toContain('genPubStats');
    expect(html).not.toMatch(/Math\.random\(\).*USER_DB|USER_DB.*Math\.random\(\)/s);
    expect(html).not.toContain('互相打分：对方也给你评分');
    expect(html).not.toMatch(/charCodeAt\([^)]*\).*?(?:likes|eggCoins)|(?:likes|eggCoins).*?charCodeAt\(/s);
    expect(html).not.toContain("school: '杭州电子科技大学'");
    expect(html).toContain("role: 'guest'");
    expect(html).toContain('registered: false');
    expect(blindBoxApp).not.toMatch(/profiles\s*=\s*\[[^\]]+\]/s);
    expect(html).toContain('var userSkills = [];');
    expect(html).not.toContain("var userSkills = ['Python'");
    expect(html).not.toContain('var pubStats = isAdmin ?');
    expect(html).not.toContain('var pubMbti = isAdmin ?');
    expect(html).not.toContain("'超然物外'");
  });

  it('starts user balances and character progress from empty server-backed state', () => {
    for (const staleValue of ['>410<', '>260<', '>52<', '>32<']) {
      expect(html).not.toContain(staleValue);
    }
    expect(html).not.toMatch(/current:\s*'game'/);
    expect(html).not.toMatch(/count:\s*[1-9]\d*\s*,\s*unlocked:\s*true/);
    expect(html.match(/count:\s*0\s*,\s*unlocked:\s*false/g)).toHaveLength(6);
    expect(html).not.toContain('adminChar:');
    expect(apiClient).not.toMatch(/registered:\s*true,\s*(?:isAdmin:\s*false,\s*)?points:\s*100/);
  });

  it('keeps production lists connected to server APIs', () => {
    expect(html).toContain('apiClient.publicTasks');
    expect(html).toContain('apiClient.myTasks');
    expect(html).toContain('apiClient.leaderboard');
    expect(html).toContain('apiClient.inquiries');
    expect(html).toContain('apiClient.pointTransactions');
    expect(html).toContain('apiClient.invitations');
    expect(html).toContain('apiClient.publicProfile');
    expect(apiClient).toContain("request('/api/users/' + encodeURIComponent(id) + '/public-profile')");
  });

  it('uses the persisted publisher identity when rendering a public task card', () => {
    const publicTaskRenderer = html.match(/function renderServerPlazaTask\(task\)\{([\s\S]*?)\n  \}\n  async function syncPublicTaskPlazas/);

    expect(publicTaskRenderer?.[1]).toContain("data-publisher-id");
    expect(publicTaskRenderer?.[1]).toContain('var publisher = task.publisher || null;');
    expect(publicTaskRenderer?.[1]).toContain('publisher.nickname');
    expect(publicTaskRenderer?.[1]).not.toContain("|| '用户'");
  });

  it('does not fabricate publisher identities or profile statistics in a public task detail', () => {
    const taskDetailBody = html.match(/function showTaskDetail\(btn\)\{([\s\S]*?)\n  \}\n  function closeTaskDetail/);

    expect(taskDetailBody?.[1]).not.toContain('char-eggy-hermit.jpg');
    expect(taskDetailBody?.[1]).not.toContain('隐士蛋·蛋总');
    expect(taskDetailBody?.[1]).not.toContain('knowledge:10,skills:10,charm:10,money:10,reputation:5');
    expect(taskDetailBody?.[1]).toContain("data-publisher-id");
  });

  it('does not replace an empty administrator task description with a bundled sample', () => {
    const administratorPublishBody = html.match(/async function publishGroup\(\)\{([\s\S]*?)\r?\n  \}\r?\n\r?\n  \/\* ===== Chip groups/);

    expect(administratorPublishBody).not.toBeNull();
    expect(administratorPublishBody![1]).not.toContain("|| '蛋总发布任务'");
    expect(administratorPublishBody![1]).toContain("toast('请输入任务描述')");
  });

  it('starts admin counters from zero and omits development-only navigation', () => {
    expect(html).toMatch(/id="pendingBadge" hidden><\/span>/);
    expect(html).toMatch(/id="submissionsBadge" hidden><\/span>/);
    expect(html).toMatch(/id="usersCount">0<\/span>/);
    expect(html).toMatch(/id="feedbackBadge" hidden><\/span>/);
    expect(html).not.toContain('data-page="states"');
    expect(html).not.toContain("'states'");
    expect(html).not.toContain('组件交互状态');
    expect(html).not.toContain('较上周 +12%');
    expect(html).not.toContain('本月新增 3 个');
    expect(html).not.toContain('共 6 份提交待批改');
    expect(html).not.toMatch(/class="bell-badge">[1-9]\d*<\/span>/);
  });

  it('starts task plaza result counts from zero until REST data is rendered', () => {
    expect(html).toMatch(/id="plazaResultCount">找到 0 个任务<\/div>/);
    expect(html).toMatch(/id="helpResultCount">找到 0 个求助<\/div>/);
    expect(html).toMatch(/id="teamResultCount">找到 0 个组队<\/div>/);
  });

  it('treats REST task responses as the only task state after writes', () => {
    expect(html).not.toMatch(/pendingCount\s*(?:\+\+|--|[+\-]=)/);
    expect(html).not.toContain('adminWorkspace.pendingReviews.push(');
    expect(html).not.toContain('adminWorkspace.pendingReviews.splice(');
    expect(html).not.toMatch(/plaza\.appendChild\(p\)/);
    expect(html).toContain('async function syncAdminReviewQueue()');
    expect(html).toMatch(/reviewTask\(taskId,\s*\{ status: 'approved' \}\)[\s\S]*?await syncAdminReviewQueue\(\);[\s\S]*?await syncPublicTaskPlazas\(\);/);
    expect(html).toMatch(/reviewTask\(taskId,\s*\{ status: 'needs_revision' \}\)[\s\S]*?await syncAdminReviewQueue\(\);/);
  });

  it('does not retain unreachable DOM-only task creation or deletion branches', () => {
    expect(html).not.toContain('function addToMyTasks(');
    expect(html).not.toContain('function deleteMyTask(');
    expect(html).not.toContain('function deleteGroup(');
  });

  it('does not retain unreachable manual task refresh or detail branches', () => {
    for (const functionName of [
      'updateTaskStatus',
      'refreshMyTasks',
      'showMyTaskDetail',
      'showPublishedTaskDetail',
      'refreshPublishedTasks',
      'acceptCancelRequest',
      'rejectCancelRequest',
      'publisherAcceptCancel',
      'publisherRejectCancel',
    ]) {
      expect(html).not.toContain(`function ${functionName}(`);
    }
  });

  it('does not infer publisher identity, level, or rarity from front-end text', () => {
    expect(html).not.toContain('function renderPubEggs(');
    expect(html).not.toContain('isAdminPub');
    expect(html).not.toContain('char-eggy-hermit.jpg');
    expect(html).not.toContain('knowledge:10');
    expect(html).not.toContain("rarity = 'UR'");
    expect(html).not.toContain("var mbtiType = USER.mbtiType || 'INFJ'");
    expect(html).toContain("var mbtiType = USER.mbtiType || '未设置'");
  });

  it('does not submit a bundled answer or keep local-only notifications', () => {
    expect(blindBoxApp).not.toContain('我也在练习把大目标拆成今天能完成的一小步');
    expect(html).not.toContain("'qa-answer': ['askWall', {answer:");
    const notificationSyncBody = html.match(/async function syncNotifications\(\)\{([\s\S]*?)\n  \}\n  function addNotif/);
    expect(notificationSyncBody).not.toBeNull();
    expect(notificationSyncBody![1]).not.toContain('localPending');
    expect(notificationSyncBody![1]).not.toContain('localOnly');
  });

  it('uses the server response as the blind-box draw result', () => {
    const drawBody = blindBoxApp.match(/function runDraw\(\)\s*\{([\s\S]*?)\n\}\n\nfunction openCompose/);
    expect(drawBody).not.toBeNull();
    expect(drawBody![1]).toContain('drawBox');
    expect(drawBody![1]).toContain('result.action');
    expect(drawBody![1]).not.toMatch(/Math\.random\(\)/);
    expect(drawBody![1]).not.toContain('selectedTodayAction = options[');
  });

  it('does not fabricate profile data or cache local profile records', () => {
    const saveBioBody = html.match(/async function saveBio\(\)\{([\s\S]*?)\n  \}\n\n  async function renderMyRatings/);
    expect(saveBioBody).not.toBeNull();
    expect(saveBioBody![1]).not.toContain('publicProfiles[USER.nickname] =');
    expect(saveBioBody![1]).not.toContain('5.0');
    expect(saveBioBody![1]).not.toContain('这个人很懒');
    const profileModalBody = html.match(/async function showUserEggModal\(userName, userId\)\{([\s\S]*?)\n    var eggLabel/);
    expect(profileModalBody).not.toBeNull();
    expect(profileModalBody![1]).not.toContain("CHAR_STATE.current || '学业技术'");
    expect(profileModalBody![1]).not.toContain("USER.stats.reputation || 5.0");
    expect(profileModalBody![1]).not.toContain('这个人很懒');
  });

  it('loads uncached public profiles by stable user id and escapes profile content', () => {
    const profileModalBody = html.match(/async function showUserEggModal\(userName, userId\)\{([\s\S]*?)\n  \}\n\n  \/\/ 用户认可接口/);

    expect(profileModalBody).not.toBeNull();
    expect(profileModalBody![1]).toContain('await window.apiClient.publicProfile(userId)');
    expect(profileModalBody![1]).toContain('escapeHtml(user.bio');
    expect(profileModalBody![1]).toContain('escapeHtml(s)');
    expect(html).toContain('publisherId:String(inquiry.userId)');
    expect(html).toContain('authorId:String(reply.userId)');
    expect(html).toContain('authorId:String(comment.userId)');
  });

  it('renders real claimer egg data and escapes claimer profile fields', () => {
    const openManagerBody = html.match(/async function openClaimerManager\(btn\)\{([\s\S]*?)\n  \}\n\n  function renderClaimerList/);
    const renderListBody = html.match(/function renderClaimerList\(taskName\)\{([\s\S]*?)\n  \}\n\n  function toggleClaimerSelect/);

    expect(openManagerBody).not.toBeNull();
    expect(openManagerBody![1]).toContain('profile.eggCategory');
    expect(openManagerBody![1]).toContain('profile.eggRarity');
    expect(openManagerBody![1]).not.toContain("egg: '生活互助'");
    expect(openManagerBody![1]).not.toContain("rarity: 'N'");
    expect(openManagerBody![1]).not.toContain("bio: profile.bio || '已提交任务认领'");
    expect(renderListBody).not.toBeNull();
    expect(renderListBody![1]).toContain('escapeHtml(c.name)');
    expect(renderListBody![1]).toContain('escapeHtml(c.bio)');
    expect(renderListBody![1]).toContain('escapeHtml(c.claimerContact)');
  });

  it('does not display a default MBTI group or ranking identity when the server omits it', () => {
    expect(html).not.toContain("renderMbtiSubPick(subRow, USER.mbtiGroup || 'NF')");
    expect(html).toContain('renderMbtiSubPick(subRow, USER.mbtiGroup || null)');
    const rankingBody = html.match(/RANK_USERS = \(result\.users \|\| \[\]\)\.map\(function\(user\)\{([\s\S]*?)\n      \}\);/);
    expect(rankingBody).not.toBeNull();
    expect(rankingBody![1]).not.toContain("|| '学业技术'");
    expect(rankingBody![1]).not.toContain("|| '蛋蛋用户'");
  });

  it('reloads task views after assignment and cancellation instead of mutating task cards locally', () => {
    const assignBody = html.match(/async function confirmAssign\(\)\{([\s\S]*?)\n  \}\n\n  function closeClaimerModal/);
    const cancelBody = html.match(/async function confirmCancelTask\(\)\{([\s\S]*?)\n  \}\n\n  \/\* ===== 认领管理/);

    expect(assignBody?.[1]).toMatch(/await Promise\.all\(\[syncMyTasks\(\), syncPublicTaskPlazas\(\), syncPointTransactions\(\)\]\);/);
    expect(assignBody?.[1]).not.toMatch(/pubCards\.forEach\(|claimedCards\.forEach\(/);
    expect(cancelBody?.[1]).toMatch(/await Promise\.all\(\[syncMyTasks\(\), syncPublicTaskPlazas\(\), syncPointTransactions\(\)\]\);/);
    expect(cancelBody?.[1]).not.toContain('cancelTaskCtx.card.remove()');
  });

  it('does not add transient local records to the persisted notification view', () => {
    const addNotificationBody = html.match(/function addNotif\(data, type\)\{([\s\S]*?)\n  \}\n  function updateNotifBadge/);

    expect(addNotificationBody?.[1]).toContain('syncNotifications();');
    expect(addNotificationBody?.[1]).not.toContain('notifications.unshift(');
    expect(addNotificationBody?.[1]).not.toContain('localOnly:true');
  });

  it('does not call a removed client-side refund scanner during page initialization', () => {
    expect(html).not.toMatch(/\bscanAndRefundExpiredTasks\s*\(/);
  });

  it('does not fabricate a task invitation notification without a persistence API', () => {
    const inviteBody = html.match(/function sendInviteTask\(\)\{([\s\S]*?)\n  \}\n  function endorseUser/);
    expect(inviteBody).not.toBeNull();
    expect(inviteBody![1]).not.toContain('addNotif(');
    expect(inviteBody![1]).not.toContain("已向 ' + targetName + ' 发送邀请");
  });

  it('completes submitted task claims through the persistence API before rating', () => {
    const reviewBody = html.match(/async function reviewMyTask\(btn\)\{([\s\S]*?)\n  \}\n  async function confirmReviewAndRate/);
    const confirmBody = html.match(/async function confirmReviewAndRate\(idx\)\s*\{([\s\S]*?)\n  \}\n  function closeReviewSubmit/);
    const publishedTaskBody = html.match(/function renderSyncedPublishedTask\(task\)\{([\s\S]*?)\n  \}\n  function renderSyncedClaimedTask/);

    expect(html).not.toContain('PUBLISHER_RATINGS');
    expect(reviewBody).not.toBeNull();
    expect(reviewBody![1]).toContain('apiClient.taskClaims');
    expect(confirmBody).not.toBeNull();
    expect(confirmBody![1]).toContain('await window.apiClient.completeTask');
    expect(confirmBody![1]).toContain('syncPointTransactions()');
    expect(confirmBody![1]).toContain('openRating(');
    expect(publishedTaskBody).not.toBeNull();
    expect(publishedTaskBody![1]).toContain('onclick="openClaimerManager(this)"');
    expect(publishedTaskBody![1]).toContain('onclick="reviewMyTask(this)"');
  });

  it('does not retain DOM-only team completion and point-transfer branches', () => {
    expect(html).not.toContain('function teamConfirmComplete(');
    expect(html).not.toContain('function teamPublisherConfirm(');
  });

  it('submits the selected task skill labels to the persistence API', () => {
    expect(html).toMatch(/createTask\(\{[^}]*skillCategory:\s*selectedSkillCat\s*\|\|\s*null[^}]*skillSubcategory:\s*selectedSkillSub\s*\|\|\s*null[^}]*\}\)/s);
  });

  it('loads admin users from the server and does not fake moderation writes', () => {
    expect(html).toContain('async function syncAdminUsers()');
    expect(html).toMatch(/if\(id === 'users'\) syncAdminUsers\(\)/);
    expect(html).toContain("document.getElementById('usersCount').textContent = adminWorkspace.users.length");
    expect(html).not.toContain('function toggleBanUser(');
    expect(html).not.toContain('function toggleVerifiedUser(');
    expect(html).not.toContain("u.status === 'banned'");
    expect(html).toContain('var completed = u.completed;');
    expect(html).toContain('var inProg = u.inProgress;');
  });

  it('persists profile skills and refreshes inquiries from canonical APIs', () => {
    expect(html).toMatch(/async function saveSkills\(\)[\s\S]*?apiClient\.updateMe\(\{ skills: tempSkills\.slice\(\) \}\)[\s\S]*?hydrateUserState\(\)/);
    expect(html).not.toContain('GOSSIP_POSTS.unshift(');
    expect(html).toMatch(/id="levelGap"[^>]*>0<\/b>/);
  });

  it('loads profile ratings from the server without rewriting reputation locally', () => {
    expect(apiClient).toContain("request('/api/users/me/ratings')");
    const ratingsBody = html.match(/async function renderMyRatings\(\)\{([\s\S]*?)\n  \}\n\n  \/\* ===== Task Category/);
    expect(ratingsBody).not.toBeNull();
    expect(ratingsBody![1]).toContain('apiClient.myRatings');
    expect(ratingsBody![1]).not.toContain('USER.stats.reputation =');
  });

  it('persists character and MBTI selections before rendering the refreshed profile', () => {
    expect(apiClient).toContain("setCurrentCharacter: function (category) { return request('/api/users/me/characters/current'");
    expect(html).toContain('async function persistCharacterSelection(category, mbtiType)');
    expect(html).toContain('await window.apiClient.setCurrentCharacter(category);');
    expect(html).toContain('await window.apiClient.updateMe({ mbtiType: mbtiType });');
    expect(html).toMatch(/await hydrateUserState\(\);[\s\S]*?renderChar\(\);[\s\S]*?refreshProfile\(\);/);
    expect(html).not.toContain('USER.mbtiGroup = CHAR_STATE.modalMbti;');
    expect(html).not.toContain('USER.mbtiType = CHAR_STATE.modalMbtiType;');
  });

  it('reloads every inquiry mutation from the canonical API instead of appending local records', () => {
    expect(html).toMatch(/async function likeGossipPost\(id\)[\s\S]*?syncGossipInquiries\(true\)/);
    expect(html).toMatch(/async function likeGossipAnswer\(postId, answerId\)[\s\S]*?syncGossipInquiries\(true\)/);
    expect(html).toMatch(/async function adoptGossipAnswer\(postId, answerId\)[\s\S]*?syncGossipInquiries\(true\)/);
    expect(html).toMatch(/async function submitGossipComment\(postId, answerId\)[\s\S]*?syncGossipInquiries\(true\)/);
    expect(html).toMatch(/async function submitGossipAnswer\(postId\)[\s\S]*?syncGossipInquiries\(true\)/);
    expect(html).not.toContain('answer.comments.push(');
    expect(html).not.toContain('post.answers.push(');
    expect(html).not.toContain('post.adopted = true;');
    expect(html).not.toContain('post.coinStatus = \'transferred\';');
    expect(html).not.toContain('post.liked = Boolean(result.liked);');
    expect(html).not.toContain('answer.liked = Boolean(result.liked);');
  });

  it('connects every visible feedback control to the persisted feedback APIs', () => {
    for (const handler of [
      'openFeedbackModal',
      'closeFeedbackModal',
      'selectFbType',
      'submitFeedback',
      'syncFeedbackTickets',
      'filterFbTickets',
      'filterFbByType',
      'closeReplyModal',
      'confirmReply',
      'appendFeedbackMessage',
    ]) {
      expect(html).toMatch(new RegExp(`function ${handler}\\s*\\(`));
    }
    expect(html).toContain('window.apiClient.submitFeedback(');
    expect(html).toContain('window.apiClient.myFeedback()');
    expect(html).toContain('window.apiClient.adminFeedback()');
    expect(html).toContain('window.apiClient.updateFeedback(');
    expect(html).toContain('window.apiClient.addFeedbackMessage(');
  });
});
