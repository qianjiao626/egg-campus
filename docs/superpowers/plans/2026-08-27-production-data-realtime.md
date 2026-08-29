# 蛋蛋校园生产数据与实时化改造实施计划

> **执行方式：** 当前主会话内逐项执行；按用户要求禁止子智能体。每项先写失败测试，再做最小实现并运行回归。

**目标：** 清除生产演示业务数据，修复任务、注册、会话、个人页和邀请码链路，并为任务、盲盒、树洞及排行榜增加权限隔离的 WebSocket 事件通知。

**架构：** MySQL 是唯一业务事实来源，REST 继续承担全部业务读写，WebSocket 只传事件并触发前端 REST 刷新。现有单页 UI 原位清理和接线，商城保持隐藏，“航线”项目完全隔离。

**技术栈：** Node.js、TypeScript、Fastify 5、Prisma 6、MySQL、Zod、Vitest、`@fastify/websocket`、`ws`、原生 HTML/CSS/JavaScript、Nginx、PM2。

## 2026-08-27 最终验收结论

- [x] 隔离库真实写入 E2E 22/22 通过，报告：`docs/online-test-reports/2026-08-27-isolated-e2e.md`。
- [x] 全量 Vitest：42 个测试文件、215 项测试全部通过。
- [x] 本机 `npm run build` 通过；CVM 未执行 TypeScript 或前端构建。
- [x] 最新发布按哈希只增量更新 `growth-school.html` 与后端 `dist/src/app.js`；保留 `.env`、`node_modules`，服务器未执行 build。
- [x] 生产首页、health、公开 REST 均为 200；两位固定管理员登录、`/me`、Cookie refresh 均成功且各有 52 项权限。
- [x] 公网 WSS 握手成功；Nginx 配置有效并为 `active`；两个蛋蛋校园 PM2 进程 online 且错误日志为空。
- [x] 商城代码完整保留，前端继续通过 `data-shop-enabled="false"` 隐藏，服务端 `SHOP_ENABLED=false`，商城迁移未执行。
- [x] 未读取或修改“航线”与 Supabase。

## 全局约束

- 不整体重写 `backend-handoff-package/growth-school.html`，保留现有样式、按钮和 MPI 蛋蛋小人。
- 不删除现有 REST 接口；WebSocket 只做增强，且可一键关闭。
- 生产账号仅保留 `蛋总-敦敦`、`蛋总-千焦`、`教练`；生产清理按已授权规则不备份。
- 测试只写 `dandan_campus_test`；生产库不得写测试账号或测试记录。
- 商城前端继续隐藏，不执行 `202608260007_egg_mall`。
- 手机号登录和短信配置继续取消；昵称登录与可选邮箱保留。
- 每个关键步骤检查原始输出，失败即停在该步骤修复。

---

### 任务 1：任务技能字段与可见性领域规则

**文件：**
- 新建：`server/src/task-visibility.ts`
- 修改：`server/prisma/schema.prisma`
- 新建：`server/prisma/migrations/202608270001_task_skills_invites/migration.sql`
- 新建：`server/tests/task-visibility.test.ts`

**接口：**
- `taskVisibilityWhere(input: { userId: bigint; canReview: boolean; view: 'public' | 'review' | 'mine' }): Prisma.TaskWhereInput`
- `Task.skillCategory: string | null`
- `Task.skillSubcategory: string | null`

- [x] 写测试：普通用户公开查询只得到 `approved`；审核者队列得到 `pending_review`、`needs_revision`、`rejected`；本人查询只按 `userId`。
- [x] 运行 `npx vitest run tests/task-visibility.test.ts`，确认因模块不存在失败。
- [x] 实现纯函数并补 Prisma 字段和非商城迁移。
- [x] 运行目标测试与 `npx prisma validate`。

### 任务 2：任务 REST 持久化与人数聚合

**文件：**
- 修改：`server/src/app.ts`
- 修改：`server/src/permissions.ts`
- 修改：`backend-handoff-package/api-client.js`
- 新建：`server/tests/task-persistence-contract.test.ts`

**接口：**
- `GET /api/tasks`
- `GET /api/admin/tasks/review-queue`
- `PATCH /api/tasks/:id`
- `POST /api/tasks/:id/abandon`
- 任务响应字段：`skillCategory`、`skillSubcategory`、`activeClaimCount`、`claimStatus`

- [x] 写 Fastify 契约测试，覆盖公开、审核、本人三种可见性及创建/编辑技能字段。
- [x] 写接取与放弃测试，断言数据库聚合人数和当前用户接取标记，不接受前端本地计数。
- [x] 运行目标测试，确认新路由/字段缺失导致失败。
- [x] 修改 Zod schema、任务序列化、路由查询和事务。
- [x] 运行任务契约测试及现有 `business-contract.test.ts`。

### 任务 3：邀请关系和幂等奖励

**文件：**
- 修改：`server/prisma/schema.prisma`
- 修改：`server/prisma/migrations/202608270001_task_skills_invites/migration.sql`
- 新建：`server/src/invitations.ts`
- 修改：`server/src/auth/validation.ts`
- 修改：`server/src/app.ts`
- 新建：`server/tests/invitation-contract.test.ts`

**接口：**
- `bindInvitation(tx, invitedUserId, inviteCode): Promise<void>`
- `rewardInvitationForApprovedTask(tx, invitedUserId, taskId): Promise<{ rewarded: boolean; inviterId?: bigint }>`
- `GET /api/users/me/invitations`

- [x] 写测试覆盖无效邀请码、自邀、重复绑定、首次审核奖励 `20`、重复审核不奖励。
- [x] 运行测试确认失败。
- [x] 增加 `Invitation` 模型、唯一约束、注册事务绑定和审核事务奖励。
- [x] 增加邀请码汇总/历史接口，所有 BigInt 序列化为字符串。
- [x] 运行邀请测试和认证会话测试。

### 任务 4：注册错误与持久会话契约加固

**文件：**
- 修改：`server/src/app.ts`
- 修改：`server/src/auth/validation.ts`
- 修改：`backend-handoff-package/api-client.js`
- 修改：`backend-handoff-package/growth-school.html`
- 新建：`server/tests/registration-errors-contract.test.ts`

**接口：**
- 注册错误稳定返回 `{ error: string, message: string }`
- `apiClient.restoreSession()` 通过 refresh cookie 和 `/api/users/me` 恢复，不持久化 token

- [x] 写测试覆盖 Zod 参数错误、重复昵称、邀请码错误和模拟数据库异常不泄漏堆栈。
- [x] 补前端契约测试，断言密码提示“密码不低于8位”且非法参数不调用 fetch。
- [x] 运行目标测试确认失败。
- [x] 完成 Fastify 错误映射和前端中文提示；保留 HttpOnly refresh cookie 方案。
- [x] 运行认证相关全部测试。

### 任务 5：生产前端静态业务数据清理

**文件：**
- 修改：`backend-handoff-package/growth-school.html`
- 修改：`backend-handoff-package/api-client.js`
- 修改：`backend-handoff-package/blind-box/app.js`
- 新建：`server/tests/production-data-frontend-contract.test.ts`

**接口：**
- 所有列表容器默认空状态，通过 `apiClient` 拉取后渲染。
- 禁止定义 `DEMO_POINT_LOGS`、`DEMO_GOSSIP_POSTS` 或带 `data-demo="true"` 的业务卡片。

- [x] 写文本契约测试，精确禁止生产 Demo 数组、假任务卡、假排行榜用户、假邀请码历史和本地计数回写。
- [x] 运行测试并确认命中现有静态数据而失败。
- [x] 删除静态业务记录及其合并逻辑，保留固定空状态和渲染函数。
- [x] 接入真实任务、榜单、树洞、个人资产与邀请历史接口。
- [x] 运行前端契约测试和盲盒内容契约测试。

### 任务 6：个人页布局原位调整

**文件：**
- 修改：`backend-handoff-package/growth-school.html`
- 新建：`server/tests/profile-layout-contract.test.ts`

**接口：**
- 删除 `profile-head` 用户信息 DOM。
- `profileIdentitySummary` 位于 `#page-profile .topbar` 右侧，显示当前用户昵称和学校。

- [x] 写 DOM 文本契约测试，断言中部长条不存在、顶部身份节点存在、MPI 组件仍存在。
- [x] 运行测试确认失败。
- [x] 原位移动动态绑定节点并调整响应式 CSS，不创建嵌套卡片。
- [x] 运行布局契约和现有资料更新测试。

### 任务 7：WebSocket 服务端事件总线

**文件：**
- 修改：`server/package.json`
- 修改：`server/src/app.ts`
- 修改：`server/src/server.ts`
- 新建：`server/src/realtime.ts`
- 修改：`server/src/types/fastify.d.ts`
- 新建：`server/tests/realtime.test.ts`

**接口：**
- `RealtimeEvent = { type: string; resourceId: string; scope: 'public' | 'admin' | 'private'; occurredAt: string }`
- `publishPublic(event)`、`publishAdmin(event, permissionKey)`、`publishPrivate(userIds, event)`
- `GET /api/realtime` WebSocket Upgrade

- [x] 安装 `@fastify/websocket` 与 `ws` 并写事件路由测试。
- [x] 测试未认证连接拒绝、公共事件只给登录用户、管理员事件检查实时 RBAC、私有事件只给目标用户。
- [x] 运行测试确认实现缺失而失败。
- [x] 实现连接注册、断开清理、事件广播和关闭钩子。
- [x] 在任务、盲盒、树洞和资产变更成功后发布事件，任何事件失败不得回滚已提交 REST 业务。
- [x] 运行实时测试与后端全套测试。

### 任务 8：前端实时客户端、生命周期和降级

**文件：**
- 新建：`backend-handoff-package/realtime-client.js`
- 修改：`backend-handoff-package/growth-school.html`
- 修改：`backend-handoff-package/blind-box/app.js`
- 新建：`server/tests/realtime-frontend-contract.test.ts`

**接口：**
- `window.DandanRealtime.connect(accessToken)`
- `subscribe(eventTypes, handler): () => void`
- `disconnect()`
- `window.DANDAN_REALTIME_ENABLED = true`

- [x] 写契约测试覆盖全局开关、有限指数退避、一次性错误日志、REST 全量降级和取消订阅。
- [x] 运行测试确认文件不存在而失败。
- [x] 实现单连接客户端，并在页面进入/离开时注册和销毁监听。
- [x] 将事件映射到现有 REST 加载函数，禁止 WebSocket 直接修改业务状态。
- [x] 运行前端契约测试。

### 任务 9：白名单生产清理工具

**文件：**
- 新建：`server/src/production-cleanup.ts`
- 新建：`server/src/scripts/cleanup-production-data.ts`
- 修改：`server/package.json`
- 新建：`server/tests/production-cleanup.test.ts`

**接口：**
- `assertCleanupAllowlist(users): void`
- `cleanupProductionData(client, ['蛋总-敦敦', '蛋总-千焦', '教练']): Promise<CleanupResult>`
- 命令 `npm run data:cleanup-production -- --confirm=DELETE_NON_ALLOWLISTED_USERS`

- [x] 写纯规则与事务客户端测试，断言白名单缺失、额外账号、身份错误时拒绝执行。
- [x] 运行测试确认失败。
- [x] 实现显式确认、事务删除顺序、账户重置和唯一初次上线流水。
- [x] 在测试数据库运行两次：第一次成功，第二次保持相同结果，证明幂等。
- [x] 查询验证只剩三个账号、余额均为 `100`、每人一条流水。

### 任务 10：独立测试环境、部署和循环验收

**文件：**
- 新建：`server/.env.test.example`
- 修改：`server/cvm-deploy.sh`
- 修改：`server/README.md`
- 新建：`docs/online-test-reports/README.md`
- 修改：`docs/obsidian-sync/06-变更日志.md`

**接口：**
- 测试库名 `dandan_campus_test`
- 测试报告列：测试时间、用例项、预期结果、实际结果、是否通过、问题简述

- [x] 本机运行 `npm test -- --run`、`npm run build`、`npx prisma validate` 和 `git diff --check`。
- [x] 使用磁盘私钥创建测试库并部署独立测试进程；不打印连接串或秘密。
- [x] 迁移测试库并通知独立测试会话开始首轮完整测试。
- [x] 修复测试报告中的全部问题，重复测试直到全通过。
- [x] 本机生成前端产物并增量上传生产服务器，保留服务器 `node_modules`。
- [x] 校验 Nginx WebSocket Upgrade 配置后重载；后端业务哈希存在预期变化，隔离 E2E 通过后重启生产进程，并检查 PM2 日志、Nginx、健康接口、REST 和 WebSocket。
- [x] 执行已授权生产清理命令并做最终数据库核验。
- [x] 更新 Obsidian 变更日志，记录问题原因、修复和部署验证结果。
