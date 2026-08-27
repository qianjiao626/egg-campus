# 登录、角色档案、任务广场与消息角标实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user explicitly requires implementation in the current task and a separate Codex testing task, not implementation subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复个人页登录状态与线上注册，重做真实角色档案和任务广场卡片，并统一隐藏所有零值消息角标。

**Architecture:** 新增原生 JavaScript `DandanAppState` 作为认证身份、当前角色和未读数的单一前端事实源，现有 REST 与 HttpOnly refresh cookie 继续负责业务数据和会话。任务接口补充发布者角色元数据，页面保留现有 DOM 与操作逻辑，只替换卡片渲染和局部样式；anime.js 作为本地静态 ESM 文件按需加载，失败时无动画降级。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Fastify 5、Prisma 6、MySQL、Vitest 3、anime.js 4.5.0、Playwright、Nginx、PM2。

## Global Constraints

- 不引入 React、Vue、Next.js、Tailwind 或外部 CDN。
- 不向 `localStorage` 或 `sessionStorage` 写入 access token、refresh token、密码或用户私密资料。
- 商城前后端继续关闭，不修改商城页面、路由、权限和迁移。
- 不触碰“航线”项目或 Supabase。
- 注册不显示手机号，不提供手机号登录或短信配置；邮箱选填且不要求验证码。
- 用户名与密码必填，密码长度 8-128；其余注册资料为空时不得阻断请求。
- 角色档案不显示虚构角色等级；用户等级只能由真实 `exp` 通过现有 `getLevel()` 计算并标明为用户成长等级。
- 动效只修改 `transform` 和 `opacity`；`prefers-reduced-motion: reduce` 下不加载 anime.js。
- anime.js 必须本地部署并附 MIT 许可证；不得请求第三方运行时资源。
- 保留现有任务筛选、发布、审核、详情和接取逻辑；业务权限仍由后端判定。
- 消息入口框始终显示；只有规范化数量大于零时才显示数字。
- 服务器不执行前端或 TypeScript build，不删除 `node_modules`；仅上传哈希变化文件。
- 禁止运行会包含商城迁移的全量 `prisma migrate deploy`。
- 所有远程命令使用 `C:\Users\梁惠\.ssh\id_ed25519`、`IdentitiesOnly=yes`、`BatchMode=yes`。
- 保留生产账号 `蛋总-敦敦`、`蛋总-千焦`、`教练` 和用户真实注册数据。

---

### Task 1: 启动独立线上测试任务并冻结基线

**Files:**
- Create: `docs/online-test-reports/2026-08-27-auth-profile-task-ui-cycle.md`
- Modify: `task_plan.md`
- Modify: `progress.md`

**Interfaces:**
- Consumes: 生产地址 `https://dsxnb.com/dd/` 与当前项目目录。
- Produces: 每轮包含测试时间、用例项、预期结果、实际结果、是否通过、问题简述的测试报告。

- [ ] **Step 1: 创建独立 Codex 测试任务**

使用 Codex `create_thread` 创建用户可见的独立测试任务，并用 Codex heartbeat 为该测试任务配置每 10 分钟一次的检查。提示词要求只写测试报告和回传问题，不修改源码、不部署、不调用实现子智能体；全部用例通过后暂停 heartbeat。

- [ ] **Step 2: 写入首轮失败基线**

首轮必须覆盖：刷新后个人页身份、完整选填注册、任务广场、角色档案、零角标、WebSocket 降级、盲盒、吐槽、排行榜、邀请码。未测试项目写“阻塞”及原因，不能伪造通过。

- [ ] **Step 3: 记录当前工作树而不清理用户改动**

Run: `git status --short`

Expected: 输出当前大量已知改动；不得执行 reset、checkout、clean 或全量覆盖。

### Task 2: 建立轻量前端状态模块

**Files:**
- Create: `backend-handoff-package/app-state.js`
- Test: `server/tests/frontend-app-state.test.ts`
- Modify: `backend-handoff-package/growth-school.html`

**Interfaces:**
- Produces: `window.DandanAppState.getState()`、`setState(patch)`、`subscribe(listener)`、`setUnreadCount(key, value)`、`reset()`。
- State: `{ authStatus, currentUser, currentCharacter, unreadCounts }`。

- [ ] **Step 1: 写状态模块失败测试**

测试用 Node `vm` 注入最小 `window`，断言初始状态为 `restoring`、订阅会收到新快照、负数/空值/非数字归零、取消订阅后不再调用、`reset()` 回到 `guest` 且清空私有状态。

```ts
expect(state.getState().authStatus).toBe('restoring');
state.setUnreadCount('notifications', -3);
expect(state.getState().unreadCounts.notifications).toBe(0);
state.setState({ authStatus: 'authenticated', currentUser: { id: '7' } });
state.reset();
expect(state.getState()).toMatchObject({ authStatus: 'guest', currentUser: null, currentCharacter: null });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/frontend-app-state.test.ts`

Expected: FAIL，因为 `app-state.js` 尚不存在。

- [ ] **Step 3: 实现状态模块**

模块使用 IIFE，快照在返回和通知时浅复制；`setState` 只接受四个已知顶层字段；监听器异常不能中断其他监听器。

```js
window.DandanAppState = {
  getState: getState,
  setState: setState,
  subscribe: subscribe,
  setUnreadCount: setUnreadCount,
  reset: reset
};
```

- [ ] **Step 4: 在主页面按正确顺序加载**

在现有主业务内联 `<script>` 之前加入带版本号的 `app-state.js`，确保初始会话状态可用；`api-client.js` 仍保留在页面底部。不得把主业务脚本改为 module script，避免破坏现有全局函数。

- [ ] **Step 5: 运行定向测试**

Run: `npm test -- tests/frontend-app-state.test.ts tests/frontend-auth-contract.test.ts`

Expected: PASS。

### Task 3: 统一会话恢复、登录、资料与角色状态

**Files:**
- Modify: `backend-handoff-package/api-client.js`
- Modify: `backend-handoff-package/growth-school.html`
- Test: `server/tests/frontend-app-state.test.ts`
- Test: `server/tests/frontend-auth-contract.test.ts`
- Test: `server/tests/profile-layout-contract.test.ts`

**Interfaces:**
- Consumes: `DandanAppState`、`apiClient.restoreSession()`、`apiClient.me()`、`apiClient.characters()`。
- Produces: `applyAuthenticatedUser(user)` 与 `renderSessionIdentity(state)`；侧边栏和个人页不再各自猜测登录状态。

- [ ] **Step 1: 写身份同步失败契约**

断言页面加载 `app-state.js`；恢复中不写“未登录”；`dandan:session-restored` 成功时调用统一写入函数；`profileNickname` 和 `profileSchool` 由状态订阅渲染；资料保存后用 `/api/users/me` 返回值刷新状态。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/frontend-app-state.test.ts tests/frontend-auth-contract.test.ts tests/profile-layout-contract.test.ts`

Expected: FAIL，指出仍由多个 `USER` 写入点直接驱动视图。

- [ ] **Step 3: 实现统一认证写入**

```js
function applyAuthenticatedUser(user) {
  USER = Object.assign({}, USER, user, { registered: true });
  window.DandanAppState.setState({ authStatus: 'authenticated', currentUser: USER });
}
```

登录、管理员登录、注册成功、session restore、`hydrateUserState()`、资料更新都调用该函数。只有 refresh 明确失败时调用 `DandanAppState.reset()`。

- [ ] **Step 4: 实现个人页订阅渲染**

`renderSessionIdentity` 在 `authenticated` 时显示真实昵称和 `school || '学校未填写'`；`restoring` 时显示加载状态；只有 `guest` 显示“未登录”。订阅只注册一次。

- [ ] **Step 5: 同步当前角色**

`hydrateUserState()` 从 `characters` 中选择 `isCurrent` 记录写入 `currentCharacter`；没有当前角色时写 `null`，不得创造默认已解锁角色。

- [ ] **Step 6: 验证会话与资料契约**

Run: `npm test -- tests/frontend-app-state.test.ts tests/frontend-auth-contract.test.ts tests/profile-layout-contract.test.ts tests/profile-update.test.ts`

Expected: PASS。

### Task 4: 复现并修复完整注册流程

**Files:**
- Modify: `server/src/app.ts`
- Modify: `server/src/auth/validation.ts`
- Modify: `backend-handoff-package/api-client.js`
- Test: `server/tests/auth-session-flow.test.ts`
- Test: `server/tests/registration-errors-contract.test.ts`
- Test: `server/tests/frontend-auth-contract.test.ts`

**Interfaces:**
- Registration request: `{ nickname, password, email?, inviteCode?, school?, major?, city?, grade?, age?, mbtiType?, mbtiGroup?, eggCategory? }`。
- Registration response: `201 { user, accessToken }` 与 HttpOnly refresh cookie；业务错误使用稳定中文消息。

- [ ] **Step 1: 读取生产注册错误而不输出机密**

Run: `ssh -i "C:\Users\梁惠\.ssh\id_ed25519" -o IdentitiesOnly=yes -o BatchMode=yes root@119.45.253.94 "pm2 logs dandan-world --nostream --lines 200"`

Expected: 找到注册请求对应的 Prisma 错误类型/字段；不得输出 `.env`、DATABASE_URL、JWT 或 cookie。若命令失败，保留原始错误并停止远程流程。

- [ ] **Step 2: 写完整选填资料失败测试**

请求使用全部可填写字段但不含 `verificationToken`，断言 `201`、`verifiedEmailAt: null`，且事务不调用 `verificationCode.findFirst/updateMany`。同时读取 `app.ts` 注册路由片段，断言其中不存在 `registrationChannel`、`registrationTarget` 或 `VerificationTokenError`。

```ts
payload: {
  nickname: '完整资料用户', password: 'correct-password', email: 'full@example.com',
  school: '南京某大学', major: '计算机', city: '南京', grade: '大二', age: 20,
  mbtiType: 'INTJ', mbtiGroup: 'NT', eggCategory: 'study'
}
```

- [ ] **Step 3: 运行注册测试确认失败**

Run: `npm test -- tests/auth-session-flow.test.ts tests/registration-errors-contract.test.ts tests/frontend-auth-contract.test.ts`

Expected: FAIL，静态路由契约会命中旧邮箱验证码分支。

- [ ] **Step 4: 删除注册路由的邮箱验证码消费分支**

保留找回密码验证码路由；注册事务直接创建用户，邮箱存在时只做格式、唯一性和敏感词校验，`verifiedEmailAt` 固定为 `null`。删除注册专用 `registrationChannel`、`registrationTarget` 和 `VerificationTokenError` 分支。

- [ ] **Step 5: 对齐前端可选字段**

空字符串转 `null`，前端不要求 MBTI 或抽蛋才能提交基础账号；这两项有值时照常提交。密码提示固定为“密码不少于 8 位”，后端继续 8-128 双重校验。

- [ ] **Step 6: 保持可读错误映射**

重复昵称/邮箱返回 `409`；Zod 参数错误返回 `400`；Prisma 初始化/连接错误返回 `503`；响应不得包含堆栈、SQL、连接地址或字段值。

- [ ] **Step 7: 修复生产 schema 漂移的条件分支**

仅当 Step 1 明确为缺失的非商城字段时，创建并审核 `server/prisma/manual/20260827_registration_schema_repair.sql`，文件只包含日志确认缺失的字段，然后通过 `prisma db execute --file server/prisma/manual/20260827_registration_schema_repair.sql` 执行；若是数据库连接或 MySQL 1045，则不创建该文件，只修环境变量/账号授权，不执行迁移、不反复重启。

- [ ] **Step 8: 运行注册测试**

Run: `npm test -- tests/auth-session-flow.test.ts tests/registration-errors-contract.test.ts tests/frontend-auth-contract.test.ts tests/validation.test.ts`

Expected: PASS。

### Task 5: 改造真实角色档案卡

**Files:**
- Modify: `backend-handoff-package/growth-school.html`
- Test: `server/tests/profile-layout-contract.test.ts`

**Interfaces:**
- Consumes: `DandanAppState.currentCharacter`、`CHAR_CATS`、`CHAR_STATE`、真实 `USER.exp`。
- Produces: 保留 `charSection`、`charDisplay`、`charImg`、`charUnlockedRow` 的“角色护照”布局。

- [ ] **Step 1: 写角色档案失败契约**

断言保留 MPI 节点；新增 `characterPassport`、`characterPassportName`、`characterPassportStatus`；不存在硬编码 `LV.6`、假成长百分比和默认满属性。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/profile-layout-contract.test.ts`

Expected: FAIL，因为角色护照节点尚不存在。

- [ ] **Step 3: 实现角色护照布局**

卡片使用真实角色图、分类映射名称、稀有度、解锁/当前使用状态和真实数量。用户成长等级可显示 `getLevel(USER.exp).name`，标签必须写“用户成长等级”。

- [ ] **Step 4: 实现空状态和响应式**

无当前角色时保留卡片框并显示“尚未选择角色”，不隐藏整块；390px 下图片与文字改为上下排列，无内部滚动条。

- [ ] **Step 5: 运行角色档案测试**

Run: `npm test -- tests/profile-layout-contract.test.ts tests/frontend-app-state.test.ts`

Expected: PASS。

### Task 6: 补充任务发布者角色元数据

**Files:**
- Modify: `server/src/app.ts`
- Test: `server/tests/task-persistence-contract.test.ts`
- Test: `server/tests/task-visibility.test.ts`

**Interfaces:**
- `serializeTask(task).publisher`: `{ id, nickname, eggCategory, eggRarity } | null`。
- Existing task fields: `publishExpReward`、`reward`、`activeClaimCount`、`maxClaimers` 保持原义。

- [ ] **Step 1: 写任务响应失败测试**

让 `taskListInclude()` 的用户 mock 包含 `eggCategory: 'study'`、`eggRarity: 'R'`，断言公开任务响应携带这两个字段且不泄露邮箱、手机或联系方式。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/task-persistence-contract.test.ts tests/task-visibility.test.ts`

Expected: FAIL，因为 publisher 当前只有 id 与 nickname。

- [ ] **Step 3: 扩展最小 Prisma select 与序列化**

```ts
user: { select: { id: true, nickname: true, eggCategory: true, eggRarity: true } }
```

不得查询或返回邮箱、手机号、学校等与任务卡无关的资料。

- [ ] **Step 4: 运行任务接口测试**

Run: `npm test -- tests/task-persistence-contract.test.ts tests/task-visibility.test.ts`

Expected: PASS，原草稿/待审核/公开可见性断言不变。

### Task 7: 重做任务广场卡片并接入 anime.js

**Files:**
- Modify: `backend-handoff-package/growth-school.html`
- Create: `backend-handoff-package/motion.js`
- Create: `backend-handoff-package/vendor/anime.esm.min.js`
- Create: `backend-handoff-package/vendor/anime-LICENSE.md`
- Create: `backend-handoff-package/THIRD_PARTY_NOTICES.md`
- Test: `server/tests/task-plaza-ui-contract.test.ts`
- Test: `server/tests/frontend-motion.test.ts`

**Interfaces:**
- `window.DandanMotion.animateTaskCards(elements)`。
- `window.DandanMotion.highlightTaskCard(element)`。
- `renderServerPlazaTask(task)` 继续返回带原 data attributes 和 `.claim-btn` 的 HTMLElement。

- [ ] **Step 1: 写任务卡与动效失败测试**

断言任务卡包含标题、四类标签上限、发布者角色、`publishExpReward`、蛋蛋币、两至三行描述、人数、详情按钮；动效模块有 reduced-motion、动态 import 失败降级和旧动画取消逻辑。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/task-plaza-ui-contract.test.ts tests/frontend-motion.test.ts`

Expected: FAIL，因为新版结构和 motion 模块不存在。

- [ ] **Step 3: 固定来源提取 anime.js**

Run: `npm pack animejs@4.5.0 --json`

Expected integrity: `sha512-NQimYX+lz8WaXonGS9zVVoviCIAjONeJayxacUditaivYLqyXgGjFKjuyl0aUUhFKm5MriX9ty1TGovNzoJQWA==`。

只提取 `dist/bundles/anime.esm.min.js` 和 `LICENSE.md`，删除 tgz 临时包；第三方声明记录 `animejs@4.5.0`、Uiverse.io、作者 `Admin12121` 和来源链接。

- [ ] **Step 4: 实现懒加载动效包装器**

`matchMedia('(prefers-reduced-motion: reduce)')` 为真时直接 resolve；否则首次调用动态导入 `./vendor/anime.esm.min.js`。卡片入场 360ms、Y 12px、间隔 36ms；失败只 `console.warn` 一次。

- [ ] **Step 5: 实现潮玩任务卡**

使用莓果粉主强调、电光紫、青绿、湖蓝和明黄状态色，正文保持浅色高对比。桌面两列、移动单列，圆角不超过 8px；复用 Uiverse 的局部强调层关系，但不复制演示 SVG 或固定尺寸。

- [ ] **Step 6: 保留全部业务挂钩**

保留 `data-task-id`、发布者 ID、类型、技能、人数、奖励、要求及 `.claim-btn`；筛选后调用 `animateTaskCards`，实时更新单卡调用 `highlightTaskCard`。

- [ ] **Step 7: 运行任务卡测试**

Run: `npm test -- tests/task-plaza-ui-contract.test.ts tests/frontend-motion.test.ts tests/task-persistence-contract.test.ts`

Expected: PASS。

### Task 8: 统一零值消息角标

**Files:**
- Modify: `backend-handoff-package/growth-school.html`
- Modify: `backend-handoff-package/app-state.js`
- Test: `server/tests/unread-badge-contract.test.ts`
- Test: `server/tests/frontend-app-state.test.ts`

**Interfaces:**
- `renderUnreadBadge(elementOrId, value)`：返回规范化整数；零值设置 `hidden=true` 且不写字符 `0`。
- Managed keys: `notifications`、`reviewQueue`、`submissions`、`feedback`。

- [ ] **Step 1: 写零角标失败测试**

断言 `notifBadge`、`notifBadgeStudent`、`pendingBadge`、`submissionsBadge`、`feedbackBadge` 的容器入口仍存在；所有更新路径都调用 `renderUnreadBadge`；普通统计仍允许显示零。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/unread-badge-contract.test.ts tests/frontend-app-state.test.ts`

Expected: FAIL，至少审核、待批改和反馈仍直接写 `0`。

- [ ] **Step 3: 实现统一角标渲染**

```js
function renderUnreadBadge(target, value) {
  var count = Math.max(0, Math.floor(Number(value) || 0));
  var element = typeof target === 'string' ? document.getElementById(target) : target;
  if (!element) return count;
  element.hidden = count === 0;
  element.textContent = count > 0 ? String(count) : '';
  return count;
}
```

- [ ] **Step 4: 接入全部消息计数更新**

通知、审核队列、待批改、反馈处理完成后先写 `DandanAppState.setUnreadCount`，再由订阅渲染；接口失败时保留入口框并隐藏未知数字。

- [ ] **Step 5: 运行角标测试**

Run: `npm test -- tests/unread-badge-contract.test.ts tests/frontend-app-state.test.ts tests/frontend-auth-contract.test.ts`

Expected: PASS。

### Task 9: 完整验证与视觉验收

**Files:**
- Create: `docs/online-test-reports/2026-08-27-auth-profile-task-ui-local.md`
- Modify: `progress.md`

**Interfaces:**
- Produces: 自动化、响应式和回归验证结果；任何失败都返回对应任务修复。

- [ ] **Step 1: 运行完整测试**

Run: `npm test`

Expected: 全部测试通过，不以旧的 249 数量硬编码成功标准。

- [ ] **Step 2: 运行 TypeScript 构建**

Run: `npm run build`

Expected: exit 0。

- [ ] **Step 3: 检查前端脚本语法与 diff**

Run: `node --check ../backend-handoff-package/api-client.js`

Run: `node --check ../backend-handoff-package/app-state.js`

Run: `node --check ../backend-handoff-package/motion.js`

Run: `git diff --check`

Expected: 全部 exit 0；CRLF 提示不算错误，但空白错误必须修复。

- [ ] **Step 4: 启动本地静态预览**

Run: `npx http-server backend-handoff-package -a 127.0.0.1 -p 4175 -c-1`

Expected: `http://127.0.0.1:4175/growth-school.html` 可访问；如果端口占用，选择一个空闲端口并记录。

- [ ] **Step 5: Playwright 响应式验收**

检查 390x844、768x1024、1440x900：身份一致、角色护照、任务卡两列/单列、文字不遮挡、`scrollWidth === clientWidth`、零角标数字不可见但入口框存在、console 0 error。

- [ ] **Step 6: 等待独立测试任务报告并修复**

读取测试任务最新报告；所有失败在当前任务修复后，让测试任务继续下一轮。不得把未验证项标成通过。

### Task 10: 增量部署腾讯云并做生产验收

**Files:**
- Modify: `docs/obsidian-sync/06-变更日志.md`
- Modify: `docs/obsidian-sync/03-部署与数据隔离.md`
- Modify: `task_plan.md`
- Modify: `progress.md`

**Interfaces:**
- Deployment target: `root@119.45.253.94:/root/dan-campus`。
- Production URL: `https://dsxnb.com/dd/`。

- [ ] **Step 1: 本地构建并校验产物**

Run from `server`: `npm run build`

Expected: exit 0；服务器不得 build。

- [ ] **Step 2: 计算变更文件清单**

使用 `git diff --name-only` 和 SHA-256 比对，只选择本次前端文件、`server/dist` 对应变化及已批准的非商城 SQL。明确排除 `.env`、商城迁移、日志、截图和完整 `node_modules`。

- [ ] **Step 3: rsync 增量同步**

通过本机可用的 rsync/WSL 使用指定私钥、`--partial --append-verify` 与排除规则同步到 `/root/dan-campus`。若 rsync 不可用，只打包 Step 2 文件并用同一私钥 scp，禁止全量上传。

- [ ] **Step 4: 校验远程依赖和配置**

仅当 `package-lock.json` 变化时在服务器执行 `npm install --registry=https://registry.npmmirror.com`，保留已有 `node_modules`。运行 `nginx -t`，失败立即停止。

- [ ] **Step 5: 重载服务并逐项检查**

`nginx -s reload` 后使用 PM2 重启当前后端；随后检查当前 PID 日志、`/dd/health`、注册、刷新恢复、个人页、任务广场和零角标。PM2 online 不能替代日志和 HTTP 检查。

- [ ] **Step 6: 生产验收**

Expected:

- `https://dsxnb.com/dd/health` 返回 200。
- 全资料注册返回 201，邮箱不要求验证码。
- 刷新后侧边栏与个人页为同一真实用户。
- 任务广场显示真实发布者角色、经验、蛋蛋币和人数。
- 零消息数字不可见，入口框可点击。
- 日志无新增 5xx、MySQL 1045、Prisma 初始化错误或商城路由暴露。

- [ ] **Step 7: 更新 Obsidian 与协作记录**

记录根因、变更文件、anime.js/Uiverse 来源、测试结果、部署时间、生产检查和可复用经验；不得记录密码、私钥、cookie、JWT 或 DATABASE_URL。
