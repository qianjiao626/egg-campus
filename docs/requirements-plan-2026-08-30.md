# 蛋蛋校园安全修复 Implementation Plan

> 需求计划：本文件将 `docs/fix-plan-2026-08-30.md` 转换为可排期、可验收的修复需求，供后续实现与评审使用。

**Goal:** 修复蛋蛋校园当前已确认的资金完整性、存储型 XSS、幂等/限流和错误信息泄露风险，并建立覆盖这些风险的回归测试。

**Architecture:** 后端继续沿用 Fastify 路由、Prisma 数据模型和统一错误处理；涉及奖励资金时以明确的冻结状态和幂等流水为事实来源。前端继续使用无构建原生 JavaScript 和单文件 HTML，优先采用现有 `escapeHtml`、共享 API 客户端和事件委托模式。

**Tech Stack:** Fastify 5、Prisma、Zod、TypeScript、Vitest；原生 JavaScript、单文件 HTML；MariaDB/Prisma 迁移。

## Global Constraints

- 后端代码位于 `server/src`，测试位于 `server/tests`；前端代码位于 `backend-handoff-package`。
- 货币单位“蛋蛋币 / 声望 / prestige”均对应 `pointAccount.availableBalance`。
- 所有资金入账必须通过 `applyBuddyPointDelta`，并携带稳定、唯一、不可重放的幂等键。
- 不得信任客户端传入的奖励金额、权限、幂等键语义或资源归属。
- 生产数据库迁移必须先在备份和临时环境验证，再执行生产迁移。
- 不新增前端构建链；优先复用仓库已有工具和编码约定。
- 不提交密码、Token、验证码、短信密钥或云 Secret。

## Scope

### In scope

- P0 资金漏洞：盲盒正向刷币、审核前取消任务退款、自审冻结不对称。
- P0 前端存储型 XSS：排行榜昵称、内联属性字符串、分叉 HTML 文件同步。
- P1：悬赏扣款幂等键、登录限流及限流器清理、黑名单计数类型、盲盒错误脱敏。
- P2：按域拆分后端路由、合并 API 客户端、事件绑定现代化、敏感词与错误模型统一、状态单一来源、去除 `as any`。
- P3：行尾规范、测试产物清理、盲盒页面 self-XSS 修复。
- 每项 P0/P1 修复对应的 Vitest 回归测试、部署前验证和回滚记录。

### Out of scope

- 不改变蛋蛋币、悬赏、审核、商城和盲盒的产品规则，只修复其资金与安全边界。
- 不在本计划中重做前端视觉、页面布局或无关业务模块。
- 不把根站“航线”及其 Supabase 纳入部署范围。
- P2 架构重构不作为 P0/P1 发布的前置条件，可分批独立交付。

## Priority Requirements

### P0-1：禁止客户端控制正向入账

**Affected files:** `server/src/app.ts` 的 `/api/buddy-box/features` 和 `buddyFeatureSchema`；新增 `server/tests/buddy-box-prestige-abuse.test.ts`。

**Requirement:** `prestige/settle` 不得使用 `payload.delta` 为用户增加余额。推荐删除该正向入账分支；若产品必须保留结算玩法，服务端必须自行计算只读的业务结果，正向奖励必须来自一次性、不可重放的可信事件。`box/draw` 仅保留服务端计算的 `-1` 扣费路径。

**Acceptance:** 初始余额 100 的用户使用两个不同幂等键连续提交 `prestige/settle`、`delta=100` 后余额不得增加；正常 `box/draw` 扣 1，余额不足返回 409 和 `INSUFFICIENT_PRESTIGE`；重复请求不产生重复流水。

### P0-2：退款必须对应已冻结奖励

**Affected files:** `server/src/app.ts` 的任务创建、审核、取消和 `cancelTaskAndRefund`；Prisma `Task` 模型及迁移；新增 `server/tests/task-refund-integrity.test.ts`。

**Requirement:** 引入明确的 `rewardFrozen` 资金状态。任务创建时不冻结；首次进入 `approved` 时无论审核者是否为发布者都冻结一次，并将状态置为真；退款或结算后原子置回假。取消接口只有在 `rewardFrozen=true` 时才允许退款，退款与状态变更必须使用同一幂等语义。禁止通过任务状态推断资金是否已冻结。

**Acceptance:** 未审核的 reward/help/team 任务直接取消，发布者余额不变且无 `task_reward_refund` 流水；审核通过后余额扣除正确，取消后只恢复一次；team 退款额与冻结额均为 `reward * maxClaimers`；重复取消保持幂等；自审路径也必须先冻结再允许完成付款。

### P0-3：排行榜昵称统一 HTML 转义

**Affected files:** `backend-handoff-package/growth-school.html` 的排行榜和 gossip 名称渲染；`growth-school.rollback-real-data.html`（若仍在线使用）；相关前端回归/手工验证记录。

**Requirement:** 所有来自 `user.nickname` 的 HTML 文本插值统一使用现有 `escapeHtml()`，覆盖 podium、rank 和 gossip top 等渲染点。不得通过关闭 CSP 或过滤少量标签替代上下文转义。

**Acceptance:** 昵称 `<img src=x onerror=alert(1)>` 在排行榜中显示为纯文本；不会弹窗、发起网络请求或执行脚本；管理员和普通用户看到的排行榜行为一致。

### P0-4：修复内联属性双层上下文注入

**Affected files:** `growth-school.html` 的 `escapeInlineString` 及其调用点（附件名、昵称、授权面板等）。

**Requirement:** 长期方案是用 `data-*` 属性和事件委托替换 `onclick="fn('...')`；在迁移完成前，`escapeInlineString` 必须同时处理反斜杠、单引号、换行、`&`、双引号和 `<`，且先转义 `&`。所有手写弱转义点必须统一调用该函数。

**Acceptance:** 上传文件名 `a" onmouseover="alert(1)" x=".jpg` 和含双引号昵称在附件列表、管理员授权面板中均不触发事件注入；属性值和可见文本保持正确显示。

### P0-5：处理活跃分叉文件

**Affected file:** `backend-handoff-package/growth-school.rollback-real-data.html`。

**Requirement:** 在发布前确认该文件是否仍被部署。若废弃，删除文件并以 Git 历史保存；若仍使用，P0-3/P0-4 必须与主 HTML 同步修复，并建立单一发布来源，避免两份文件产生安全修复漂移。

**Acceptance:** 发布包中不存在未修复的活跃副本；构建/发布检查能明确标记主版本和 rollback 文件的状态。

### P1-1：稳定悬赏扣款幂等键

**Affected files:** `server/src/app.ts` 的 `POST /api/inquiries` 及对应 Zod schema、前端打听创建调用、相关测试。

**Requirement:** 删除 `Date.now()` 参与幂等键的做法。优先由客户端生成 UUID 并提交 `idempotencyKey`，服务端使用 `inquiry-bounty:${idempotencyKey}`；或者先落库 inquiry，再以 `inquiry.id` 扣款。服务端必须校验幂等键格式、归属和重放结果。

**Acceptance:** 相同幂等键重复提交只扣一次币且只创建一条 inquiry；网络超时重试不会双扣；不同业务请求不会错误共享幂等结果。

### P1-2：登录限流并清理限流器状态

**Affected files:** `server/src/app.ts` 登录入口、`server/src/rate-limit.ts`、新增登录限流测试。

**Requirement:** 对 IP 和登录标识分别限流，建议 IP 20 次/5 分钟、标识 10 次/15 分钟；超限返回 429 与 `retry-after`。`InMemoryRateLimiter` 在时间戳清空后删除 key，避免长期内存增长；保留单机内存限流的部署限制说明，并为多实例 Redis 迁移留下明确记录。

**Acceptance:** 连续错误登录最终返回 429；窗口过期后可重新尝试；失效 key 会被删除；正常登录不因另一用户或另一 IP 的失败记录被误伤。

### P1-3：黑名单计数只接受数字

**Affected file:** `backend-handoff-package/blacklist.js` 的结果计数渲染。

**Requirement:** 将后端返回的计数规范化为 `Number(result.count) || 0`，禁止把未验证字符串拼入 HTML。

**Acceptance:** 后端返回标签、空值或非法字符串时，页面只显示数字 0 或合法数字，不执行脚本。

### P1-4：盲盒错误信息脱敏

**Affected files:** `backend-handoff-package/blind-box/buddy-box-api.js`、`api-client.js` 及共享错误处理模块。

**Requirement:** 盲盒 API 不得直接展示 `body.message`。提取并复用主客户端的 `safeApiErrorMessage`，过滤 Prisma、SQL、文件路径、堆栈和内部实现细节，同时保留可供日志定位的请求标识。

**Acceptance:** 后端返回包含 `Prisma`、`.ts:` 或 SQL 的错误时，用户界面显示通用文案；开发诊断日志仍有足够信息且不包含凭据。

## P2 Architecture and Quality

- **P2-1 后端拆分：** 将 `server/src/app.ts` 按 auth、shop、tasks、inquiries、buddy、blacklist、admin 域拆为 Fastify 插件；保持现有路由、schema、错误码和测试行为不变。
- **P2-2 API 客户端统一：** 合并 `buddy-box-api.js` 与 `api-client.js` 的 origin 判断、refresh 单飞和 401 重试逻辑，所有调用共享同一错误脱敏入口。
- **P2-3 事件绑定现代化：** 逐批迁移 `growth-school.html` 的内联 `onclick` 和全局函数到 `data-*` + `addEventListener` 委托；先覆盖 P0-4 涉及的属性数据。
- **P2-4 敏感词单一来源：** 以 `sensitive-filter.js` 为权威，删除冗余副本并让 API、盲盒和注册校验引用同一实现。
- **P2-5 错误模型统一：** 用带 `code` 的错误类替换裸字符串 `Error` 和 message 比对，交由 `setErrorHandler` 集中映射 HTTP 响应。
- **P2-6 序列化命名修正：** 将误称为 `serializeShopProduct` 的通用 BigInt 序列化逻辑改为中性名称，或按领域拆分。
- **P2-7 状态单一来源：** 明确 `DandanAppState` 或全局 `USER` 为唯一事实来源，并迁移/删除另一套写入路径。
- **P2-8 去除 `as any`：** 使用 `metricKey()` 校验后的窄类型替换 `server/src/app.ts` 中的 `query.metric as any`。

## P3 Hygiene

- 添加 `.gitattributes`，统一 `* text=auto eol=lf`，并在提交前规范 BOM/CRLF/LF。
- 调查 `server/.vitest-full-result.json` 中 `auth-session-flow.test.ts` 的 500 失败；修复真实问题，或删除产物并加入 `.gitignore`，不得把测试结果 JSON 当源码提交。
- 修复 `blind-box/app.js` 中 `chip.innerHTML` 对用户输入 `value` 的 self-XSS；使用现有 `escapeHtml`，并确认愿望内容是否会回显给其他用户。

## File and Test Map

### Backend

- Modify: `server/src/app.ts`
- Modify: `server/src/rate-limit.ts`
- Modify: Prisma `Task` schema and add a migration for `rewardFrozen`
- Add: `server/tests/buddy-box-prestige-abuse.test.ts`
- Add: `server/tests/task-refund-integrity.test.ts`
- Add/modify: inquiry idempotency and login rate-limit tests

### Frontend

- Modify: `backend-handoff-package/growth-school.html`
- Modify or delete: `backend-handoff-package/growth-school.rollback-real-data.html`
- Modify: `backend-handoff-package/blacklist.js`
- Modify: `backend-handoff-package/blind-box/buddy-box-api.js`
- Modify: `backend-handoff-package/blind-box/app.js`
- Modify: `backend-handoff-package/api-client.js` and shared client/error module
- Modify: `backend-handoff-package/sensitive-filter.js` consumers

## Validation and Release Gates

1. 先为每个 P0/P1 写红色回归测试，再实现修复；测试必须覆盖重复请求、权限边界、余额不足、恶意昵称/文件名和错误脱敏。
2. 在 `server` 目录运行 `npm test` 与 `npm run build`；数据库迁移在临时数据库执行并回滚验证。
3. 对静态前端执行恶意输入手工验证或 Playwright 浏览器验证，检查 DOM、事件、网络请求和控制台错误。
4. 发布前审查两份 HTML 是否存在未转义昵称/属性插值，检查 `server/.vitest-full-result.json` 等构建产物未进入提交。
5. P0 修复独立发布并保留回滚点；P1 在 P0 通过后发布；P2/P3 按常规迭代拆分，不阻塞 P0/P1 安全补丁。
6. 每个工作包完成后更新 `docs/obsidian-sync/` 的变更日志、验证记录和遗留风险。

## Execution Order

1. P0-1、P0-2：先封堵可直接造成余额增加或凭空退款的后端路径。
2. P0-3、P0-4、P0-5：修复排行榜、属性注入和活跃分叉文件。
3. P1-1、P1-2、P1-3、P1-4：补齐幂等、暴力尝试防护、输入类型和错误脱敏。
4. P3-1、P3-2、P3-3：清理发布卫生和剩余前端注入点。
5. P2-1 至 P2-8：在安全补丁稳定后按域拆分和逐步迁移，保持每批可独立回归。

## Open Questions

- `growth-school.rollback-real-data.html` 当前是否仍被任何部署脚本、入口页面或用户访问？这决定删除还是同步维护。
- 产品是否仍需要 `prestige/settle` 的正向奖励玩法？默认按“删除客户端可控正向入账”方案实施。
- 生产环境是否已多实例部署？若是，登录限流应在 P1 阶段同步规划 Redis 共享状态，而不是继续扩大单机内存限流的使用范围。
