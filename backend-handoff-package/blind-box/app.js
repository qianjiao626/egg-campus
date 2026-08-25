/*仅页面预览，上线删除，数据由数据库返回*/
const profiles = []; /*
  {id:'lin-shen',name:'林深',meta:'大二 · 计算机科学 · 本科',avatar:'avatar-lin',score:'98% 同频',copy:'最近在研究独立游戏，也想找个人一起交换奇怪但好听的歌。',tags:['写代码','玩游戏','分享歌单'],reason:'都选择了「玩游戏 + 分享歌单」'},
  {id:'xiao-man',name:'小满',meta:'大一 · 视觉传达 · 本科',avatar:'avatar-man',score:'94% 同频',copy:'喜欢拍校园里的小角落，周末想去逛一家没去过的咖啡店。',tags:['拍照','探店','周末出门'],reason:'都把「拍照」放进了最近在做的事'},
  {id:'zhou-zhou',name:'周周',meta:'大三 · 新闻传播 · 本科',avatar:'avatar-zhou',score:'91% 同频',copy:'INTP 友好型选手，正在找一位可以安静自习、偶尔聊天的朋友。',tags:['看书','一起自习','INTP'],reason:'你们都选了「一起自习」'},
  {id:'a-yao',name:'阿遥',meta:'研一 · 心理学 · 硕士',avatar:'avatar-yao',score:'89% 同频',copy:'下班后喜欢玩合作解谜，最近想认真认识一个新朋友。',tags:['玩游戏','找人聊天','INFJ'],reason:'都期待「找人聊天」'},
  {id:'gu-lu',name:'咕噜',meta:'大二 · 建筑学 · 本科',avatar:'avatar-gulu',score:'87% 同频',copy:'收集城市里的声音和旧海报，欢迎交换你的私藏歌单。',tags:['听歌','拍照','分享歌单'],reason:'你们有两项兴趣相同'},
  {id:'you-zi',name:'柚子',meta:'大四 · 经济学 · 本科',avatar:'avatar-youzi',score:'85% 同频',copy:'正在准备毕业论文，想找一个互相监督又不尴尬的搭子。',tags:['写代码','一起自习','找人聊天'],reason:'都想找一个轻松的学习搭子'}
]; */

//【数据库接入插头：对接数据库后补全此处，上层页面渲染代码无需修改】
const api = window.buddyBoxApi;
if (!api) throw new Error('盲盒交友服务端接口未加载');
window.buddyBoxApi = api;

// All feature reads and writes must come from the real backend adapter.
const buddyBoxDataAdapter = window.buddyBoxDataAdapter;
if (!buddyBoxDataAdapter) throw new Error('盲盒交友数据服务端接口未加载');

const featureState = {createdBoxes: [], completedFeatures: new Set()};
const featureUiState = {};
let safetyState = {cooldownUntil: null, stealth: false, blocked: [], echoReject: false};
let lastSyncErrorAt = 0;
function reportSyncFailure(message = '数据同步失败，请稍后刷新重试') {
  const now = Date.now();
  if (now - lastSyncErrorAt < 3000) return;
  lastSyncErrorAt = now;
  showToast(message);
}
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

const featureCatalog = [
  {group:'盲盒抽取',items:[
    {id:'quiz',icon:'问',title:'试题盲盒',desc:'先回答 3-5 道趣味小题，出题人审核通过后才开启聊天。',action:'投放试题盲盒',adapter:'createBox',fields:[['题目 1','周末更喜欢图书馆还是躺宿舍？'],['题目 2','最爱的一部电影是什么？'],['题目 3','最近循环哪首歌？']]},
    {id:'reverse',icon:'愿',title:'反向盲盒',desc:'隐藏身份发布愿望，让符合画像的人主动认领你。',action:'发布许愿盒',adapter:'publishWishBox',fields:[['我想认识的人','会弹吉他、考研数学搭子'],['匹配标签','音乐 / 学习 / 安静聊天']]},
    {id:'memory',icon:'忆',title:'记忆盲盒',desc:'7 天或 14 天后解锁资料，期间只能发送简短便签。',action:'投放时间胶囊',adapter:'createMemoryBox',fields:[['解锁周期','7 天 / 14 天'],['便签规则','仅限 50 字以内']]},
    {id:'cross-school',icon:'校',title:'跨校漂流',desc:'手动开启跨校匹配，只展示学校，不展示学院和班级。',action:'保存跨校设置',adapter:'setCrossSchool',toggle:true}
  ]},
  {group:'聊天与互动',items:[
    {id:'icebreaker',icon:'聊',title:'AI 破冰助手',desc:'只生成话题和小游戏，不读取、不改写任何聊天内容。',action:'生成一个话题',adapter:'getIcebreaker'},
    {id:'coop',icon:'组',title:'双人声望协作任务',desc:'从主任务平台接取双人任务，完成后由服务端平分声望。',action:'创建协作任务',adapter:'createCoopTask',fields:[['想做的任务','共同制作 PPT / 调研作业'],['完成方式','双方提交后等待审核']]},
    {id:'echo',icon:'纸',title:'纸条回响',desc:'会话关闭后发送单向匿名纸条，对方不能直接回复。',action:'发送回响纸条',adapter:'sendEcho',fields:[['纸条内容','想把今天的歌单分享给你'],['拒收规则','对方可随时拒收']]}
  ]},
  {group:'身份与收集',items:[
    {id:'collection',icon:'卡',title:'缘分图鉴',desc:'收集主题卡牌，只保存标签，不保存他人隐私。',action:'查看我的图鉴',adapter:'getCollection'},
    {id:'fragments',icon:'片',title:'盲盒碎片合成',desc:'退回盲盒获得不可交易碎片，合成限定主题盲盒券。',action:'检查合成条件',adapter:'craftFragment'},
    {id:'radar',icon:'雷',title:'缘分雷达',desc:'只按兴趣标签统计，不获取 GPS，也不展示具体用户。',action:'查看标签雷达',adapter:'getRadar'}
  ]},
  {group:'广场衍生',items:[
    {id:'qa-wall',icon:'问',title:'匿名问答墙',desc:'匿名提问，回答者可选择公开或拒绝；高赞回答由服务端奖励。',action:'发起匿名提问',adapter:'askWall',fields:[['想问什么','你最近在为什么事情努力？']]},
    {id:'group',icon:'群',title:'搭子盲盒小组',desc:'随机组建 3-4 人匿名兴趣小房间，超时自动解散。',action:'抽取多人小组',adapter:'createGroup',fields:[['小组主题','读书 / 游戏 / 运动'],['人数','3-4 人']]},
    {id:'wish-wall',icon:'愿',title:'心愿投递墙',desc:'匿名发布心愿，支持置顶和认领，完成后双方获得服务端结算。',action:'投递心愿纸条',adapter:'publishWishNote',fields:[['我的心愿','想找人一起看电影'],['是否置顶','普通 / 置顶']]}
  ]},
  {group:'校园安全',items:[
    {id:'cooldown',icon:'盾',title:'防纠缠冷却',desc:'拒绝后 7 天不可再次抽取；拉黑后永久屏蔽。',action:'查看安全设置',adapter:'setSafety',toggle:true},
    {id:'stealth',icon:'隐',title:'盲盒隐身模式',desc:'可被抽到但主页不可见，双方双向解锁后自动解除。',action:'保存隐身设置',adapter:'setSafety',toggle:true},
    {id:'report',icon:'报',title:'识破骚扰',desc:'敏感词与举报由服务端联动信誉、曝光权重和任务平台权限。',action:'提交安全反馈',adapter:'reportHarassment',fields:[['反馈类型','骚扰 / 敏感内容 / 其他']]}
  ]},
  {group:'限时活动',items:[
    {id:'night',icon:'夜',title:'整点限时盲盒夜',desc:'固定夜间时段开放专场，具体时间和消耗倍率由服务端下发。',action:'查看今晚专场',adapter:'getEvent'},
    {id:'festival',icon:'节',title:'开学季 / 七夕限定池',desc:'活动任务产出限定卡牌和免费抽盒次数，奖励不可交易。',action:'查看节日活动',adapter:'getEvent'}
  ]}
];

const $ = selector => document.querySelector(selector);
const grid = $('#matchGrid');
const toast = $('#toast');
const drawOverlay = $('#drawOverlay');
const messageDrawer = $('#messageDrawer');
const messageOverlay = $('#messageOverlay');
const composeOverlay = $('#composeOverlay');
const profileDetailOverlay = $('#profileDetailOverlay');
const conversationOverlay = $('#conversationOverlay');
const messageList = $('#messageList');
let rotation = 0;
let drawTimer = null;
let drawState = 'ready';
let lastFocused = null;
let composeProfile = null;
let conversationProfile = null;
let selectedTodayAction = '';
let inboxPollTimer = null;
let conversationPollTimer = null;
/*仅页面预览，上线删除，数据由数据库返回*/
let inbox = [];
const requestedProfiles = new Set();
const blockedTerms = ['加微信','加我微信','手机号','裸聊','色情','博彩','刷单'];
function findBlockedTerm(value) {
  const text = String(value || '').replace(/\s+/g, '');
  return blockedTerms.find(term => text.includes(term));
}
function validateUserText(value) {
  if (typeof window.validateDandanText === 'function' && !window.validateDandanText(value)) {
    showToast('内容包含敏感词，请修改后再提交');
    return false;
  }
  const blocked = findBlockedTerm(value);
  if (blocked) { showToast('内容包含敏感词，请修改后再提交'); return false; }
  return true;
}
const schoolsByEducation = {
  '大专':['北京电子科技职业学院','深圳职业技术大学','金华职业技术大学','无锡职业技术学院','广州番禺职业技术学院','陕西工业职业技术学院','山东商业职业技术大学','黄河水利职业技术大学','重庆电子科技职业大学'],
  '本科':['北京大学','清华大学','复旦大学','上海交通大学','浙江大学','武汉大学','中山大学','四川大学','南京大学','哈尔滨工业大学','厦门大学','西安交通大学'],
  '硕士':['北京大学研究生院','清华大学研究生院','中国科学院大学','复旦大学研究生院','上海交通大学研究生院','浙江大学研究生院','中国人民大学研究生院'],
  '博士':['北京大学博士研究生院','清华大学博士研究生院','中国科学院大学博士部','复旦大学博士研究生院','上海交通大学博士研究生院','浙江大学博士研究生院']
};

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

function avatarMarkup(className) { return `<span class="person-avatar ${className}" aria-hidden="true"></span>`; }
function activeText(group) { return [...document.querySelectorAll(`[data-group="${group}"] .choice.active`)].map(button => button.textContent.trim()); }
function selectedTodayWishes() { return activeText('today').concat([...document.querySelectorAll('.wish-chip')].map(chip => chip.dataset.wish)).filter(Boolean); }

function updatePreferenceStatus(state) {
  const count = activeText('mbti').length + activeText('hobby').length + activeText('today').length + document.querySelectorAll('.wish-chip').length;
  $('#selectedCount').textContent = count;
  const status = state || (count >= 3 ? '偏好已完成' : '尚未完成偏好');
  $('#matchStatus').textContent = status;
  $('#stageStatus').textContent = status;
}

async function saveBuddyPreferences() {
  if (typeof buddyBoxDataAdapter.savePreferences !== 'function') return;
  const textFields = [$('#school').value, $('#province').value, $('#city').value, $('#district').value];
  if (!textFields.every(validateUserText)) return;
  try {
    await buddyBoxDataAdapter.savePreferences({
      mbtiType: activeText('mbti')[0] || null,
      hobbies: activeText('hobby'),
      todayActions: selectedTodayWishes(),
      province: $('#province').value || null,
      city: $('#city').value || null,
      district: $('#district').value || null,
    });
  } catch (_) { reportSyncFailure('偏好保存失败，请稍后重试'); }
}

function applyBuddyPreferences(preference) {
  if (!preference) return;
  document.querySelectorAll('[data-group="mbti"] .choice').forEach(button => button.classList.toggle('active', button.textContent.trim() === preference.mbtiType));
  ['hobby', 'today'].forEach(group => {
    const values = new Set(Array.isArray(preference[group === 'hobby' ? 'hobbies' : 'todayActions']) ? preference[group === 'hobby' ? 'hobbies' : 'todayActions'] : []);
    document.querySelectorAll(`[data-group="${group}"] .choice`).forEach(button => button.classList.toggle('active', values.has(button.textContent.trim())));
  });
  ['province', 'city', 'district'].forEach(id => {
    const value = preference[id];
    const field = $(`#${id}`);
    if (field && value) { field.value = value; field.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  updatePreferenceStatus();
}

async function syncBuddyPreferences() {
  try {
    const result = await buddyBoxDataAdapter.getPreferences();
    applyBuddyPreferences(result?.preference);
  } catch (_) { reportSyncFailure('偏好加载失败，请稍后重试'); }
}

async function syncPlatformSnapshot() {
  //【数据库接入插头：对接数据库后补全此处】仅展示服务端返回的声望快照，不在前端计算余额。
  try {
    const snapshot = await buddyBoxDataAdapter.getTaskPlatformState();
    const prestige = snapshot?.prestige ?? (await buddyBoxDataAdapter.getPrestige())?.available;
    $('#experienceCount').textContent = prestige === null || prestige === undefined ? '待同步' : String(prestige);
  } catch (error) {
    $('#experienceCount').textContent = '待同步';
  }
}

function renderProfiles() {
  if (!profiles.length) { grid.innerHTML = '<div class="board-empty"><b>暂无可匹配用户</b><span>完成偏好后，服务端会按相似度返回真实用户。</span></div>'; return; }
  const start = rotation % profiles.length;
  const visible = profiles.slice(start, start + 3).concat(profiles.slice(0, Math.max(0, start + 3 - profiles.length))).slice(0, 3);
  grid.innerHTML = visible.map(profile => {
    const status = profile.friendStatus || (requestedProfiles.has(profile.id) ? 'pending' : 'none');
    const statusCopy = status === 'accepted' ? '已是好友' : status === 'pending' ? '已有待处理请求' : status === 'rejected_cooldown' ? '对方已拒绝' : '+ 申请加好友';
    const statusLocked = status !== 'none';
    const chatLocked = status !== 'accepted';
    return `<article class="match-card" data-profile="${profile.id}"><div class="match-top">${avatarMarkup(profile.avatar)}<div><div class="match-name">${escapeHtml(profile.name)}</div><div class="match-meta" title="${escapeHtml(profile.meta)}">${escapeHtml(profile.meta)}</div></div><span class="match-score">${escapeHtml(profile.score)}</span></div><p class="match-copy">${escapeHtml(profile.copy)}</p><p class="match-reason"><span>推荐理由</span>${escapeHtml(profile.reason)}</p><div class="tag-list">${profile.tags.map(tag => `<span class="tag ${tag.includes('INTP') ? 'teal' : ''}">${escapeHtml(tag)}</span>`).join('')}</div><div class="card-actions"><button class="skip ${chatLocked ? 'requested' : ''}" data-action="message" ${chatLocked ? 'disabled' : ''}>${chatLocked ? '仅好友可聊' : '发起聊天'}</button><button class="like ${statusLocked ? 'requested' : ''}" data-action="friend" data-friend-status="${status}" ${statusLocked ? 'disabled' : ''}>${statusCopy}</button></div></article>`;
  }).join('');
}

async function syncBuddyProfiles(action) {
  if (typeof buddyBoxDataAdapter.getRecommendations !== 'function') return;
  try {
    const result = await buddyBoxDataAdapter.getRecommendations(action);
    if (!Array.isArray(result?.profiles) || !result.profiles.length) return;
    profiles.splice(0, profiles.length, ...result.profiles.map((profile, index) => ({
       id: String(profile.id), name: profile.name, meta: profile.meta || '蛋蛋校园用户', avatar: ['avatar-lin','avatar-man','avatar-zhou','avatar-yao','avatar-gulu','avatar-youzi'][index % 6], score: '同频推荐', mbtiType: profile.mbtiType || '', bio: profile.bio || '', hobbies: profile.hobbies || [], todayActions: profile.todayActions || [], friendStatus: profile.friendStatus || 'none', friendRequestId: profile.friendRequestId || null, copy: '最近在做：' + (profile.bio || (profile.hobbies || []).join('、') || '暂未填写') + '；今天想做：' + ((profile.todayActions || []).join('、') || '暂未填写'), tags: [profile.mbtiType || '蛋蛋用户'].concat(profile.hobbies || []), reason: '根据 MBTI、最近在做和今天想做的偏好匹配'
    })));
    rotation = 0;
    renderProfiles();
  } catch (_) { reportSyncFailure('推荐加载失败，请稍后重试'); }
}

function renderInbox() {
  const unreadMessages = inbox.filter(item => item.unread && item.type === 'message').length;
  const friendRequests = inbox.filter(item => item.type === 'friend' && !item.accepted).length;
  const pending = unreadMessages + friendRequests;
  const messageCount = $('#messageCount');
  if (messageCount) messageCount.textContent = pending;
  $('#quickMessageCount').textContent = pending;
  $('#inboxSummary').textContent = `${unreadMessages} 条未读留言 · ${friendRequests} 个好友申请`;
  messageList.innerHTML = inbox.length ? inbox.map(item => `<article class="inbox-item" data-inbox="${item.id}">${avatarMarkup(item.avatar)}<div class="inbox-body"><strong>${item.name}${item.unread ? '<i class="unread-dot" aria-label="未读"></i>' : ''}</strong><p>${item.text}</p><div class="inbox-actions">${item.type === 'friend' ? `<button class="accept-friend" data-inbox-action="accept" ${item.accepted ? 'disabled' : ''}>${item.accepted ? '已成为好友' : '同意加好友'}</button>` : ''}<button class="reply-message" data-inbox-action="reply">回复留言</button></div></div></article>`).join('') : '<div class="empty-inbox">暂时没有新消息，去盲盒里认识朋友吧。</div>';
}

async function syncBuddyInbox() {
  if (typeof api.getInbox !== 'function') return;
  try {
    const result = await api.getInbox();
    const messages = Array.isArray(result?.messages) ? result.messages : [];
    const requests = Array.isArray(result?.friendRequests) ? result.friendRequests : [];
    inbox = [...messages, ...requests].map(item => ({
      ...item,
      avatar: ['avatar-lin','avatar-man','avatar-zhou','avatar-yao','avatar-gulu','avatar-youzi'][Number(item.id) % 6] || 'avatar-zhou',
      accepted: item.status === 'accepted',
    }));
    renderInbox();
  } catch (_) { reportSyncFailure('消息加载失败，请稍后重试'); }
}

function stopInboxPolling() {
  if (inboxPollTimer) { window.clearInterval(inboxPollTimer); inboxPollTimer = null; }
}
function startInboxPolling() {
  stopInboxPolling();
  inboxPollTimer = window.setInterval(syncBuddyInbox, 15000);
}

function renderBoard(records) {
  const list = $('#boardList');
  const items = (Array.isArray(records) ? records : []).map(record => {
    const payload = record?.payload && typeof record.payload === 'object' ? record.payload : {};
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text) return '';
    const owner = typeof record.ownerName === 'string' && record.ownerName ? record.ownerName : '我';
    const createdAt = record.createdAt ? new Date(record.createdAt) : null;
    const time = createdAt && !Number.isNaN(createdAt.valueOf()) ? createdAt.toLocaleString('zh-CN', {month:'numeric', day:'numeric'}) : '刚刚';
    return `<article class="board-item"><b>${escapeHtml(owner)}</b><time>${escapeHtml(time)}</time><p>${escapeHtml(text)}</p></article>`;
  }).filter(Boolean);
  list.innerHTML = items.length ? items.join('') : '<div class="board-empty"><b>还没有新留言</b><span>试试发布一个今天的邀约，等同频的人来回应。</span></div>';
}

async function syncBuddyBoard() {
  if (typeof buddyBoxDataAdapter.getBoard !== 'function') return;
  try {
    const result = await buddyBoxDataAdapter.getBoard();
    renderBoard(result?.records);
  } catch (_) { reportSyncFailure('留言加载失败，请稍后重试'); }
}

async function syncBuddyFeatureState() {
  if (typeof buddyBoxDataAdapter.getFeatureRecords !== 'function') return;
  try {
    const result = await buddyBoxDataAdapter.getFeatureRecords();
    for (const record of Array.isArray(result?.records) ? result.records : []) {
      if (!record?.feature) continue;
      featureState.completedFeatures.add(record.feature);
      const payload = record.payload && typeof record.payload === 'object' ? record.payload : {};
      const outcome = record.result && typeof record.result === 'object' ? record.result : {};
      featureUiState[record.feature] = {...featureUiState[record.feature], ...payload, ...outcome};
      if (record.feature === 'safety' && record.action === 'settings') safetyState = {...safetyState, ...outcome};
    }
    renderFeatureCenter();
  } catch (_) { reportSyncFailure('玩法状态加载失败，请稍后重试'); }
}

function lockPage(lock) { document.body.classList.toggle('no-scroll', lock); }
function focusable(container) { return [...container.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]; }
function restoreFocus() { lastFocused?.focus?.(); lastFocused = null; }

function openInbox() {
  lastFocused = document.activeElement;
  renderInbox();
  messageOverlay.classList.add('open');
  messageOverlay.setAttribute('aria-hidden', 'false');
  messageDrawer.classList.add('open');
  messageDrawer.setAttribute('aria-hidden', 'false');
  lockPage(true);
  startInboxPolling();
  $('#closeMessages').focus();
}
function closeInbox() {
  messageOverlay.classList.remove('open');
  messageOverlay.setAttribute('aria-hidden', 'true');
  messageDrawer.classList.remove('open');
  messageDrawer.setAttribute('aria-hidden', 'true');
  stopInboxPolling();
  lockPage(false);
  restoreFocus();
}

function clearDrawTimer() { if (drawTimer) { window.clearInterval(drawTimer); drawTimer = null; } }
function closeDraw({announce = true} = {}) {
  clearDrawTimer();
  drawState = 'ready';
  drawOverlay.classList.remove('open', 'drawing', 'revealed');
  drawOverlay.setAttribute('aria-hidden', 'true');
  $('#openBox').disabled = false;
  $('#openBox').innerHTML = '<span aria-hidden="true">✦</span> ' + (selectedTodayAction ? '再抽一次' : '开启我的盲盒');
  updatePreferenceStatus(selectedTodayAction ? '推荐已更新' : undefined);
  lockPage(false);
  if (announce) showToast(selectedTodayAction ? '今天的行动已收下，去认识一位同频朋友吧。' : '已取消本次抽取');
  restoreFocus();
}
function runDraw() {
  if (drawState === 'drawing') return;
  lastFocused = document.activeElement;
  const options = selectedTodayWishes().length ? selectedTodayWishes() : ['找一个新朋友聊天','去校园里散步','分享一首今天的歌','完成一次 25 分钟专注'];
  drawState = 'drawing';
  clearDrawTimer();
  $('#openBox').disabled = true;
  $('#openBox').textContent = '盲盒正在抓阄...';
  $('#drawTitle').textContent = '盲盒正在抓阄';
  $('#drawResult').textContent = '';
  $('#stageStatus').textContent = '正在生成推荐';
  drawOverlay.classList.add('open', 'drawing');
  drawOverlay.classList.remove('revealed');
  drawOverlay.setAttribute('aria-hidden', 'false');
  lockPage(true);
  buddyBoxDataAdapter.drawBox({source:'main-stage', actionPool: options, action:selectedTodayAction || null}).catch(() => reportSyncFailure('盲盒抽取结果同步失败，请稍后重试'));
  let tick = 0;
  drawTimer = window.setInterval(() => {
    $('#drawResult').textContent = `${options[tick % options.length]} · 随机中`;
    tick += 1;
    if (tick < 12) return;
    clearDrawTimer();
    selectedTodayAction = options[Math.floor(Math.random() * options.length)];
    drawState = 'revealed';
    $('#drawResult').textContent = `今日行动：${selectedTodayAction}`;
    syncBuddyProfiles(selectedTodayAction);
    $('#drawTitle').textContent = '今天就做这件事吧';
    //【数据库接入插头】抽盒后的声望变动由服务端返回；前端只保留“待同步”展示。
    $('#experienceCount').textContent = '待同步';
    drawOverlay.classList.remove('drawing');
    drawOverlay.classList.add('revealed');
    $('#openBox').disabled = false;
    $('#closeDraw').focus();
  }, 125);
}

function openCompose(profile) {
  composeProfile = profile;
  lastFocused = document.activeElement;
  $('#composeAvatar').className = `match-avatar person-avatar ${profile.avatar}`;
  $('#composeName').textContent = profile.name;
  $('#composeReason').textContent = profile.reason;
  $('#composeText').value = '';
  $('#composeCount').textContent = '0 / 180';
  composeOverlay.classList.add('open');
  composeOverlay.setAttribute('aria-hidden', 'false');
  lockPage(true);
  $('#composeText').focus();
}

function openProfileDetails(profile) {
  composeProfile = profile;
  $('#profileDetailAvatar').className = `match-avatar person-avatar ${profile.avatar}`;
  $('#profileDetailName').textContent = profile.name;
  $('#profileDetailMeta').textContent = profile.meta;
  $('#profileDetailBody').innerHTML = `<div><b>MBTI：</b>${escapeHtml(profile.mbtiType || (profile.tags || []).find(tag => /^[EI][NS][TF][PJ]$/.test(tag)) || '暂未填写')}</div><div><b>最近在做：</b>${escapeHtml(profile.bio || (profile.hobbies || []).join('、') || profile.copy || '暂未填写')}</div><div><b>今天想做：</b>${escapeHtml((profile.todayActions || []).join('、') || '暂未填写')}</div><div><b>匹配理由：</b>${escapeHtml(profile.reason || '服务端相似度推荐')}</div>`;
  const friendButton = $('#profileDetailFriend');
  const friendStatus = profile.friendStatus || 'none';
  friendButton.disabled = friendStatus !== 'none';
  friendButton.textContent = friendStatus === 'accepted' ? '已是好友' : friendStatus === 'pending' ? '已有待处理请求' : friendStatus === 'rejected_cooldown' ? '对方已拒绝' : '添加好友';
  const chatButton = $('#profileDetailChat');
  chatButton.disabled = friendStatus !== 'accepted';
  chatButton.textContent = friendStatus === 'accepted' ? '发起聊天' : '仅好友可聊';
  profileDetailOverlay.classList.add('open'); profileDetailOverlay.setAttribute('aria-hidden','false'); lockPage(true);
}
function closeProfileDetails(){ profileDetailOverlay.classList.remove('open'); profileDetailOverlay.setAttribute('aria-hidden','true'); lockPage(false); }
async function refreshConversation() {
  if (!conversationProfile || !conversationOverlay.classList.contains('open')) return;
  try {
    const result = await api.getConversation(conversationProfile.id);
    const messages = result.messages || [];
    $('#conversationMessages').innerHTML = messages.length ? messages.map(message => `<div style="align-self:${String(message.senderId) === String(conversationProfile.id) ? 'flex-start' : 'flex-end'};max-width:85%;padding:8px 12px;border-radius:12px;background:${String(message.senderId) === String(conversationProfile.id) ? '#f3f4f6' : '#e7f5ef'}">${escapeHtml(message.text)}</div>`).join('') : '<div class="board-empty">暂无聊天记录</div>';
  } catch(error) {
    $('#conversationMessages').innerHTML = `<div class="board-empty">${escapeHtml(error.message || '接受好友后才能聊天')}</div>`;
  }
}
function stopConversationPolling() {
  if (conversationPollTimer) { window.clearInterval(conversationPollTimer); conversationPollTimer = null; }
}
async function openConversation(profile){
  stopConversationPolling();
  conversationProfile = profile;
  $('#conversationAvatar').className = `match-avatar person-avatar ${profile.avatar}`;
  $('#conversationName').textContent = profile.name;
  $('#conversationMeta').textContent = profile.meta;
  $('#conversationMessages').innerHTML = '<div class="board-empty">正在加载聊天记录…</div>';
  conversationOverlay.classList.add('open'); conversationOverlay.setAttribute('aria-hidden','false'); lockPage(true);
  await refreshConversation();
  conversationPollTimer = window.setInterval(refreshConversation, 5000);
}
function closeConversation(){ stopConversationPolling(); conversationOverlay.classList.remove('open'); conversationOverlay.setAttribute('aria-hidden','true'); lockPage(false); conversationProfile = null; }

function renderFeatureCenter() {
  const container = $('#featureGroups');
  container.innerHTML = featureCatalog.map(group => `<section class="feature-group" aria-labelledby="feature-group-${group.group}"><div class="feature-group-head"><h3 id="feature-group-${group.group}">${group.group}</h3><span>${group.items.length} 项</span></div><div class="feature-grid">${group.items.map(item => `<button type="button" class="feature-card ${featureState.completedFeatures.has(item.id) ? 'feature-done' : ''}" data-feature="${item.id}"><span class="feature-icon" aria-hidden="true">${item.icon}</span><span class="feature-card-copy"><b>${item.title}</b><small>${item.desc}</small></span><span class="feature-arrow" aria-hidden="true">›</span></button>`).join('')}</div></section>`).join('');
}

function findFeature(id) { return featureCatalog.flatMap(group => group.items).find(item => item.id === id); }
function featureFieldMarkup(feature) {
  if (!feature.fields?.length && !feature.toggle) return '<div class="feature-note"><span class="feature-note-mark">i</span><p>所有声望扣减、奖励、匹配和隐私状态由服务端返回，本页面只展示结果。</p></div>';
  const fields = (feature.fields || []).map(([label, placeholder]) => `<label class="feature-field"><span>${label}</span><input data-feature-field="${label}" placeholder="${placeholder}" maxlength="180" /></label>`).join('');
  const toggle = feature.toggle ? `<label class="feature-toggle"><input type="checkbox" id="featureToggle" /><span class="toggle-track"></span><span>开启此项设置</span></label>` : '';
  const quizAdd = feature.id === 'quiz' ? '<button type="button" class="add-feature-field" id="addQuizQuestion">+ 添加第 4 / 5 题</button>' : '';
  return `${fields}${quizAdd}${toggle}<div class="feature-note"><span class="feature-note-mark">i</span><p>不涉及现金充值。声望来源于任务平台接单及合法活动奖励，具体数值由数据库决定。</p></div>`;
}
function featureResultMarkup(feature, result) {
  const state = featureUiState[feature.id] || {};
  const detail = result?.topic || result?.summary || result?.message || '状态已更新，具体结果由服务端返回。';
  const common = `<div class="feature-result"><span class="feature-result-icon">✓</span><div><strong>${escapeHtml(feature.title)}已进入下一步</strong><p>${escapeHtml(detail)}</p></div></div>`;
  const views = {
    quiz: `<div class="feature-next"><h4>等待出题人审核</h4><p>回答完整后才会解锁聊天。当前状态：<b>${state.reviewStatus || '待回答'}</b></p><div class="feature-inline-actions"><button type="button" data-feature-next="quiz-answer">开始答题</button><button type="button" data-feature-next="quiz-review">提交审核结果</button></div></div>`,
    reverse: `<div class="feature-next"><h4>公开愿望池</h4><p>已匿名发布，匹配标签将帮助同频用户认领。</p><div class="wish-preview"><span>音乐</span><span>学习</span><span>安静聊天</span></div><button type="button" data-feature-next="reverse-claim">认领这份愿望</button></div>`,
    memory: `<div class="feature-next"><h4>时间胶囊已投放</h4><p>解锁倒计时：<b>${state.countdown || '7 天'}</b>。期间仅可发送 50 字以内便签。</p><button type="button" data-feature-next="memory-note">发送一张便签</button></div>`,
    'cross-school': `<div class="feature-next"><h4>跨校匹配${state.enabled ? '已开启' : '已关闭'}</h4><p>对外只展示学校，不展示学院和班级。</p></div>`,
    icebreaker: `<div class="feature-next"><h4>今日破冰话题</h4><p class="icebreaker-topic">${escapeHtml(result?.topic || '暂无服务端破冰话题')}</p><button type="button" data-feature-next="icebreaker-refresh">换一个话题</button></div>`,
    coop: `<div class="feature-next"><h4>协作任务大厅</h4><p>当前任务：共同完成一次校园调研，双方提交后等待平台审核。</p><button type="button" data-feature-next="coop-join">加入协作任务</button></div>`,
    echo: `<div class="feature-next"><h4>回响已寄出</h4><p>这是单向匿名纸条，对方可拒收，无法直接回复。</p></div>`,
    collection: `<div class="feature-next"><h4>我的缘分图鉴</h4><div class="collection-grid"><span>初次相遇</span><span>歌单交换</span><span>学习搭子</span><span>待收集</span></div></div>`,
    fragments: `<div class="feature-next"><h4>碎片合成</h4><p>当前碎片由服务端返回，可将退回盲盒转为合成进度。</p><button type="button" data-feature-next="fragments-craft">合成盲盒券</button></div>`,
    radar: `<div class="feature-next"><h4>兴趣雷达</h4><p>${escapeHtml(result?.summary || '暂无服务端统计')}</p></div>`,
    'qa-wall': `<div class="feature-next"><h4>匿名问答墙</h4><p>问题已进入匿名墙，可选择公开回答或拒绝回答。</p><button type="button" data-feature-next="qa-answer">写一条回答</button></div>`,
    group: `<div class="feature-next"><h4>多人小组已生成</h4><p>3-4 人匿名房间将在任务完成或超时后关闭。</p><button type="button" data-feature-next="group-enter">进入小组房间</button></div>`,
    'wish-wall': `<div class="feature-next"><h4>心愿纸条已投递</h4><p>其他同学可以认领，完成后由服务端结算双方奖励。</p><button type="button" data-feature-next="wish-claim">查看可认领心愿</button></div>`,
    cooldown: `<div class="feature-next"><h4>安全设置</h4><p>${safetyState.cooldownUntil ? `当前冷却至 ${escapeHtml(safetyState.cooldownUntil)}` : '当前没有进行中的冷却'}。拒绝后的冷却与拉黑状态由服务端执行。</p><button type="button" data-feature-next="safety-refresh">刷新安全状态</button></div>`,
    stealth: `<div class="feature-next"><h4>隐身模式${safetyState.stealth ? '已开启' : '已关闭'}</h4><p>双向解锁后自动解除隐身。当前状态由主站服务端保存。</p></div>`,
    report: `<div class="feature-next"><h4>反馈已记录</h4><p>感谢反馈。服务端将联动安全审核、冷却和平台信誉。</p></div>`,
    night: `<div class="feature-next"><h4>今晚专场</h4><p>开放时间与倍率由任务平台实时下发，当前等待同步。</p></div>`,
    festival: `<div class="feature-next"><h4>限定活动池</h4><p>活动任务可获得限定卡牌和免费抽取次数，奖励不可交易。</p></div>`
  };
  return common + (views[feature.id] || '');
}
function openFeature(feature) {
  lastFocused = document.activeElement;
  $('#featureModalKicker').textContent = feature.group;
  $('#featureModalTitle').textContent = feature.title;
  $('#featureModalDescription').textContent = feature.desc;
  $('#featureModalBody').innerHTML = featureFieldMarkup(feature);
  $('#featurePrimaryAction').textContent = feature.action;
  $('#featurePrimaryAction').dataset.feature = feature.id;
  composeOverlay.classList.remove('open');
  $('#featureOverlay').classList.add('open');
  $('#featureOverlay').setAttribute('aria-hidden', 'false');
  lockPage(true);
  $('#featurePrimaryAction').focus();
  $('#addQuizQuestion')?.addEventListener('click', () => {
    const count = document.querySelectorAll('#featureModalBody [data-feature-field]').length;
    if (count >= 5) { showToast('最多设置 5 道题'); return; }
    const label = `题目 ${count + 1}`;
    const field = document.createElement('label'); field.className = 'feature-field'; field.innerHTML = `<span>${label}</span><input data-feature-field="${label}" placeholder="写一道有趣的小题" maxlength="180" />`;
    $('#addQuizQuestion').before(field);
    if (count + 1 >= 5) $('#addQuizQuestion').disabled = true;
  });
}
function closeFeature() {
  $('#featureOverlay').classList.remove('open');
  $('#featureOverlay').setAttribute('aria-hidden', 'true');
  lockPage(false);
  restoreFocus();
}
async function submitFeature(feature) {
  const fields = Object.fromEntries([...document.querySelectorAll('#featureModalBody [data-feature-field]')].map(input => [input.dataset.featureField, input.value.trim()]));
  if (!Object.values(fields).every(validateUserText)) return;
  const payload = {feature: feature.id, fields, enabled: $('#featureToggle')?.checked ?? true, source: 'buddy-box'};
  const handler = buddyBoxDataAdapter[feature.adapter];
  if (typeof handler !== 'function') { showToast('该玩法暂未连接服务端插头'); return; }
  const button = $('#featurePrimaryAction');
  button.disabled = true;
  try {
    const result = await handler(payload);
    //【数据库接入插头】服务端结果只用于更新 UI，前端不计算声望、不生成奖励数值。
    featureState.completedFeatures.add(feature.id);
    featureUiState[feature.id] = {...featureUiState[feature.id], fields, enabled: payload.enabled, reviewStatus: feature.id === 'quiz' ? '待回答' : undefined};
    if (feature.id === 'stealth') safetyState = {...safetyState, stealth: payload.enabled};
    if (feature.id === 'cooldown') safetyState = {...safetyState, echoReject: payload.enabled};
    renderFeatureCenter();
    $('#featureModalBody').innerHTML = featureResultMarkup(feature, result);
    if (result?.topic) $('#featureModalDescription').textContent = result.topic;
    showToast(`${feature.title}已提交，等待服务端处理`);
  } catch (error) { showToast('操作未完成，请稍后重试'); }
  finally {
    button.disabled = false;
    if (featureState.completedFeatures.has(feature.id)) {
      button.textContent = '已提交';
      button.disabled = true;
    }
  }
}
function closeCompose() {
  composeOverlay.classList.remove('open');
  composeOverlay.setAttribute('aria-hidden', 'true');
  composeProfile = null;
  lockPage(false);
  restoreFocus();
}

function schoolOptions(query = '') {
  const level = $('#education').value;
  const matches = (schoolsByEducation[level] || []).filter(name => name.includes(query.trim()));
  const menu = $('#schoolMenu');
  menu.innerHTML = `${matches.map(name => `<button type="button" role="option" data-school="${name}">${name}</button>`).join('')}<button type="button" role="option" class="school-custom" data-school="__custom__">其他学校，手动输入</button>`;
}
function setSchoolMenu(open) {
  const menu = $('#schoolMenu');
  if ($('#school').disabled) return;
  menu.hidden = !open;
  $('#schoolToggle').setAttribute('aria-expanded', String(open));
  if (open) schoolOptions($('#school').value);
}

document.querySelectorAll('.choice-row').forEach(row => row.addEventListener('click', event => {
  const choice = event.target.closest('.choice');
  if (!choice) return;
  if (row.dataset.group === 'hobby' && !choice.classList.contains('active') && row.querySelectorAll('.active').length >= 3) { showToast('最多选择 3 个爱好'); return; }
  if (!['hobby', 'today'].includes(row.dataset.group)) row.querySelectorAll('.choice').forEach(button => button.classList.remove('active'));
  choice.classList.toggle('active');
  updatePreferenceStatus();
  saveBuddyPreferences();
}));

$('#education').addEventListener('change', event => {
  const level = event.target.value;
  const school = $('#school');
  school.value = '';
  school.disabled = !level;
  $('#schoolToggle').disabled = !level;
  $('#schoolHint').textContent = level ? `已按${level}筛选推荐学校，也支持手动输入` : '先选学历，学校选项会自动匹配';
  setSchoolMenu(false);
  if (level) showToast(`已切换为${level}学校选项`);
  updatePreferenceStatus();
  saveBuddyPreferences();
});
$('#schoolToggle').addEventListener('click', () => setSchoolMenu($('#schoolMenu').hidden));
$('#school').addEventListener('focus', () => setSchoolMenu(true));
$('#school').addEventListener('input', event => { schoolOptions(event.target.value); $('#schoolHint').textContent = event.target.value ? '学校已填写，可继续修改或从推荐中选择' : `已按${$('#education').value}筛选推荐学校，也支持手动输入`; });
$('#schoolMenu').addEventListener('click', event => {
  const option = event.target.closest('[data-school]');
  if (!option) return;
  const school = $('#school');
  school.value = option.dataset.school === '__custom__' ? '' : option.dataset.school;
  $('#schoolHint').textContent = option.dataset.school === '__custom__' ? '请输入其他学校名称' : '已选择推荐学校';
  setSchoolMenu(false);
  school.focus();
});
document.addEventListener('click', event => { if (!event.target.closest('.school-combobox')) setSchoolMenu(false); });

$('#addWish').addEventListener('click', () => {
  const input = $('#customWish'); const value = input.value.trim();
  if (!value) { showToast('先写一个今天想做的事'); return; }
  if (!validateUserText(value)) return;
  const chip = document.createElement('span'); chip.className = 'wish-chip'; chip.dataset.wish = value; chip.innerHTML = `${value}<button type="button" aria-label="删除愿望">×</button>`;
  $('#wishPool').appendChild(chip); input.value = ''; updatePreferenceStatus(); showToast('愿望已加入抓阄池');
});
const wishPool = $('#wishPool');
if (wishPool) wishPool.addEventListener('click', event => { if (event.target.matches('button')) { event.target.parentElement.remove(); updatePreferenceStatus(); } });

$('#openBox').addEventListener('click', runDraw);
$('#closeDraw').addEventListener('click', () => closeDraw());
const messageBell = $('#messageBell');
if (messageBell) messageBell.addEventListener('click', openInbox);
$('#quickInbox').addEventListener('click', openInbox);
$('#closeMessages').addEventListener('click', closeInbox);
messageOverlay.addEventListener('click', closeInbox);
$('#closeCompose').addEventListener('click', closeCompose);
$('#cancelCompose').addEventListener('click', closeCompose);
composeOverlay.addEventListener('click', event => { if (event.target === composeOverlay) closeCompose(); });
$('#closeProfileDetail').addEventListener('click', closeProfileDetails);
profileDetailOverlay.addEventListener('click', event => { if (event.target === profileDetailOverlay) closeProfileDetails(); });
$('#profileDetailFriend').addEventListener('click', async () => {
  if (!composeProfile) return;
  if (composeProfile.friendStatus && composeProfile.friendStatus !== 'none') {
    showToast(composeProfile.friendStatus === 'accepted' ? '双方已经是好友' : composeProfile.friendStatus === 'pending' ? '已有待处理请求' : '对方已拒绝，30分钟内不能再次添加');
    return;
  }
  try { await api.applyFriend(composeProfile); composeProfile.friendStatus = 'pending'; requestedProfiles.add(composeProfile.id); renderProfiles(); closeProfileDetails(); showToast('好友申请已发送，等待对方回应'); }
  catch(error) { showToast(error.message || '好友申请未发送成功'); }
});
$('#profileDetailChat').addEventListener('click', () => { if (composeProfile) { const profile = composeProfile; closeProfileDetails(); openConversation(profile); } });
$('#closeConversation').addEventListener('click', closeConversation);
conversationOverlay.addEventListener('click', event => { if (event.target === conversationOverlay) closeConversation(); });

grid.addEventListener('click', async event => {
  const card = event.target.closest('[data-profile]'); if (!card) return;
  const profile = profiles.find(item => item.id === card.dataset.profile); if (!profile) return;
  const button = event.target.closest('button');
  if (!button) { openProfileDetails(profile); return; }
  if (button.dataset.action === 'message') { openConversation(profile); return; }
  if (button.dataset.action !== 'friend' || requestedProfiles.has(profile.id) || (profile.friendStatus && profile.friendStatus !== 'none')) return;
  button.disabled = true;
  try {
    await api.applyFriend(profile);
    profile.friendStatus = 'pending';
    requestedProfiles.add(profile.id);
    inbox.unshift({id:`friend-${Date.now()}`,name:profile.name,avatar:profile.avatar,text:'你的好友申请已发送，等待对方回应。',type:'message',unread:false});
    renderProfiles(); renderInbox(); showToast(`已向 ${profile.name} 发送好友申请`);
  } catch (error) { button.disabled = false; showToast(error.message || '好友申请未发送成功，请稍后重试'); }
});

$('#composeText').addEventListener('input', event => { $('#composeCount').textContent = `${event.target.value.length} / 180`; });
$('#composeForm').addEventListener('submit', async event => {
  event.preventDefault(); const text = $('#composeText').value.trim();
  if (!text || !composeProfile) { showToast('写一点想说的话再发送吧'); return; }
  if (!validateUserText(text)) return;
  const payload = {to: composeProfile, text, source:'match-card', action:selectedTodayAction};
  try {
    await api.sendMessage(payload);
    inbox.unshift({id:`message-${Date.now()}`,name:composeProfile.name,avatar:composeProfile.avatar,text:`你：${text}`,type:'message',unread:false});
    renderInbox(); closeCompose(); showToast(`留言已发送给 ${payload.to.name}`);
  } catch (error) { showToast('留言发送失败，请稍后重试'); }
});

$('#refresh').addEventListener('click', () => { updatePreferenceStatus('正在生成推荐'); rotation = (rotation + 3) % profiles.length; window.setTimeout(() => { renderProfiles(); updatePreferenceStatus('推荐已更新'); showToast('已换一批推荐'); }, 280); });
$('#featureGroups').addEventListener('click', event => { const card = event.target.closest('[data-feature]'); if (card) openFeature(findFeature(card.dataset.feature)); });
$('#closeFeature').addEventListener('click', closeFeature);
$('#cancelFeature').addEventListener('click', closeFeature);
$('#featureOverlay').addEventListener('click', event => { if (event.target === $('#featureOverlay')) closeFeature(); });
$('#featurePrimaryAction').addEventListener('click', () => { const feature = findFeature($('#featurePrimaryAction').dataset.feature); if (feature) submitFeature(feature); });
$('#featureModalBody').addEventListener('click', async event => {
  const button = event.target.closest('[data-feature-next]');
  if (!button) return;
  const action = button.dataset.featureNext;
  const feature = findFeature($('#featurePrimaryAction').dataset.feature);
  if (!feature) return;
  const state = featureUiState[feature.id] || {};
  if (action === 'quiz-answer') {
    $('#featureModalBody').innerHTML = `<div class="feature-next"><h4>回答 3 道小题</h4>${[1,2,3].map(index => `<label class="feature-field"><span>答案 ${index}</span><input data-answer="${index}" maxlength="180" placeholder="写下你的答案" /></label>`).join('')}<button type="button" data-feature-next="quiz-submit">提交答案</button></div>`;
    return;
  }
  if (action === 'quiz-submit') {
    const answers = [...$('#featureModalBody').querySelectorAll('[data-answer]')].map(input => input.value.trim());
    if (answers.some(value => !value)) { showToast('请先完成每一道题'); return; }
    if (!answers.every(validateUserText)) return;
    await buddyBoxDataAdapter.submitAnswers({boxId: state.boxId || null, answers, source:'buddy-box'});
    state.reviewStatus = '等待出题人审核';
    $('#featureModalBody').innerHTML = featureResultMarkup(feature, {message:'答案已提交，审核通过后解锁聊天。'});
    return;
  }
  if (action === 'quiz-review') {
    await buddyBoxDataAdapter.reviewAnswers({boxId: state.boxId || null, approved:true});
    state.reviewStatus = '已通过，可开始聊天';
    $('#featureModalBody').innerHTML = featureResultMarkup(feature, {message:'审核通过，你们可以开始聊天了。'});
    return;
  }
  if (action === 'icebreaker-refresh') {
    const result = await buddyBoxDataAdapter.getIcebreaker({refresh:true});
    $('#featureModalBody').innerHTML = featureResultMarkup(feature, result);
    return;
  }
  if (action === 'memory-note') {
    const note = window.prompt('写一张 50 字以内的便签');
    if (!note?.trim() || !validateUserText(note)) return;
    await buddyBoxDataAdapter.sendEcho({text:note.trim(), mode:'memory-note'});
    showToast('便签已送达');
    return;
  }
  if (action === 'safety-refresh') {
    if (typeof buddyBoxDataAdapter.getSafetySettings === 'function') safetyState = await buddyBoxDataAdapter.getSafetySettings();
    $('#featureModalBody').innerHTML = featureResultMarkup(feature, {message:'安全状态已刷新'});
    return;
  }
  const handlers = {
    'reverse-claim': ['claimWishBox', {wishId: state.wishId || null}],
    'coop-join': ['createCoopTask', {join:true}],
    'fragments-craft': ['craftFragment', {source:'returned-box'}],
    'qa-answer': ['askWall', {answer:'我也在练习把大目标拆成今天能完成的一小步。'}],
    'group-enter': ['createGroup', {enter:true}],
    'wish-claim': ['publishWishNote', {claim:true}]
  };
  const target = handlers[action];
  if (target) {
    await buddyBoxDataAdapter[target[0]](target[1]);
    button.textContent = action === 'reverse-claim' || action === 'wish-claim' ? '已认领' : '已加入';
    button.disabled = true;
    showToast('操作已提交，等待服务端同步');
  }
});
$('#boardText').addEventListener('input', event => { $('#charCount').textContent = `${event.target.value.length} / 180`; });
$('#messageForm').addEventListener('submit', async event => {
  event.preventDefault(); const text = $('#boardText').value.trim();
  if (!text) { showToast('先写一点内容再发布吧'); return; }
  if (!validateUserText(text)) return;
  try {
    await api.publishBoard({text});
    await syncBuddyBoard(); event.target.reset(); $('#charCount').textContent = '0 / 180'; showToast('留言已发布');
  } catch (error) { showToast('留言发布失败，请稍后重试'); }
});
messageList.addEventListener('click', async event => {
  const action = event.target.closest('[data-inbox-action]'); if (!action) return;
  const item = inbox.find(entry => entry.id === action.closest('[data-inbox]').dataset.inbox);
  if (!item) return;
  if (action.dataset.inboxAction === 'accept') {
    try { await api.acceptFriend(item.id); item.accepted = true; item.unread = false; renderInbox(); await syncBuddyProfiles(selectedTodayAction); showToast('已成为好友'); } catch (_) { showToast('好友申请处理失败，请稍后重试'); }
    return;
  }
  const text = window.prompt(`回复 ${item.name}`); if (!text?.trim() || !validateUserText(text)) return;
  try {
    const senderId = item.senderId || item.requesterId;
    if (!senderId) throw new Error('missing sender');
    await api.sendMessage({to:{id:senderId}, text:text.trim(), source:'inbox-reply', action:selectedTodayAction});
    if (item.senderId) await api.markMessageRead(item.id);
    item.unread = false; renderInbox(); showToast('回复已发送');
  } catch (error) { showToast('回复发送失败，请稍后重试'); }
});

$('#conversationText').addEventListener('input', event => { $('#conversationCount').textContent = `${event.target.value.length} / 180`; });
$('#conversationForm').addEventListener('submit', async event => {
  event.preventDefault();
  const text = $('#conversationText').value.trim();
  if (!text || !conversationProfile) return;
  if (!validateUserText(text)) return;
  try {
    await api.sendMessage({to:{id:conversationProfile.id}, text, source:'conversation'});
    $('#conversationText').value = '';
    await openConversation(conversationProfile);
    showToast('消息已发送');
  } catch(error) { showToast(error.message || '消息发送失败，请先确认双方已成为好友'); }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (composeOverlay.classList.contains('open')) closeCompose();
    else if (profileDetailOverlay.classList.contains('open')) closeProfileDetails();
    else if (conversationOverlay.classList.contains('open')) closeConversation();
    else if ($('#featureOverlay').classList.contains('open')) closeFeature();
    else if (drawOverlay.classList.contains('open')) closeDraw({announce:false});
    else if (messageDrawer.classList.contains('open')) closeInbox();
  }
  const activeModal = composeOverlay.classList.contains('open') ? composeOverlay : $('#featureOverlay').classList.contains('open') ? $('#featureOverlay') : drawOverlay.classList.contains('open') ? drawOverlay : messageDrawer.classList.contains('open') ? messageDrawer : null;
  if (event.key !== 'Tab' || !activeModal) return;
  const items = focusable(activeModal); if (!items.length) return;
  const first = items[0]; const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

async function syncSafetyState() {
  //【数据库接入插头：对接数据库后补全此处】页面只读取服务端安全状态，不在前端推断冷却或处罚。
  try { safetyState = {...safetyState, ...(await buddyBoxDataAdapter.getSafetySettings())}; } catch (error) { reportSyncFailure('安全设置加载失败，请稍后重试'); }
}
renderProfiles(); renderInbox(); renderFeatureCenter(); updatePreferenceStatus(); syncPlatformSnapshot(); syncSafetyState(); syncBuddyPreferences(); syncBuddyInbox(); syncBuddyProfiles(); syncBuddyBoard(); syncBuddyFeatureState();
/* Report content height to the host page so the host container owns scrolling. */
if (window.parent !== window) {
  const reportBuddyHeight = () => {
    const root = document.documentElement;
    const body = document.body;
    const height = Math.max(root.scrollHeight, body ? body.scrollHeight : 0);
    window.parent.postMessage({type: 'dandan-buddy-height', height}, window.location.origin);
  };
  if ('ResizeObserver' in window) new ResizeObserver(reportBuddyHeight).observe(document.body);
  window.addEventListener('load', reportBuddyHeight, {once: true});
  [0, 120, 500].forEach(delay => window.setTimeout(reportBuddyHeight, delay));
}
