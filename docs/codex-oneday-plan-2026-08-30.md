# 蛋蛋校园 · 一天修复执行计划（Codex 专用）· 2026-08-30

> 本文件是给自动编码代理（Codex）的可执行工单。请**严格按顺序**执行，每完成一个任务就跑对应验证命令，全绿再进下一个。
> 目标：一个工作日内修完全部 P0 + P1，每个修复都带一个可运行的回归测试。

---

## 0. 环境与规则（务必先读）

**技术栈**：后端 Fastify 5 + Prisma + zod（目录 `server/`，源码 `server/src/`）。前端为**无构建**的原生 JS + 单文件 HTML（目录 `backend-handoff-package/`）。

**如何跑测试**（在 `server/` 目录下）：
```bash
cd server
npm test                              # 跑全部
npx vitest run tests/<某文件>.test.ts # 跑单个
```

**测试风格（新测试必须照抄这个模式，不要连真实数据库）**：
- 用 `buildApp()` + `app.inject({ method, url, headers, payload })` 发请求。
- 在 handler 前用 `vi.spyOn(prisma.<model>, '<method>').mockResolvedValue(...)` mock 数据层。
- 事务用 `vi.spyOn(prisma, '$transaction').mockImplementation(async (cb:any)=>cb({ ... }))` 传入一个 mock 的 `tx`。
- 认证：`vi.spyOn(prisma.authSession,'findUnique').mockResolvedValue({ id:'session', userId:1n, revokedAt:null, expiresAt:new Date(Date.now()+60000) } as never)`，再 `const token = await app.jwt.sign({ sub:'1', sessionId:'session', role:'student' })`。
- 每个 test 顶部设 env：
  ```ts
  process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/dandan_world';
  process.env.JWT_SECRET = 'a-test-secret-that-is-longer-than-32-characters';
  process.env.VERIFICATION_PROVIDER = 'mock';
  ```
  参考现成范例：`server/tests/business-contract.test.ts`。
- 前端回归测试范例：`server/tests/frontend-ux-regressions.test.ts`（`readFileSync` 读 HTML/JS 再 `expect(...).toContain(...)`）。

**硬性约束**：
1. **不要跑数据库迁移**（`prisma migrate` 一律禁止）。本计划所有修复都无需改 schema。
2. **不要删除任何文件**（包括 `growth-school.rollback-real-data.html`）。删除留给人类确认。
3. 只改本工单点名的文件与位置，不要顺手重构别处。
4. 每个任务结束时全套 `npm test` 必须保持绿（除既有的 `auth-session-flow.test.ts` 那 1 个失败——见任务 8，最后处理）。
5. 保持项目现有代码风格（无分号变更、无格式化整文件）。

**时间盒建议**：上午 P0-1 / P0-2（后端漏钱，2 个测试）；午后 P0-3 / P0-4 / P0-5（前端 XSS）；收尾 P1-1 / P1-2 / P1-3 / P1-4 + 任务 8 排查。

---

## 任务 1 · P0-1 后端无限刷币（最高优先级）

**文件**：`server/src/app.ts`，`POST /api/buddy-box/features` 内，约 2395-2399 行。

**当前代码**：
```ts
    const pointDelta = input.feature === 'box' && input.action === 'draw'
      ? -1
      : input.feature === 'prestige' && input.action === 'settle'
        ? Math.max(-100, Math.min(100, Number.isInteger(payload.delta) ? Number(payload.delta) : 0))
        : 0;
```

**问题**：`payload.delta` 由客户端提供且可为正，等于让前端自报加多少币；`idempotencyKey` 也是客户端给的。任何用户循环刷 `prestige/settle delta=100` 即可无限增币，币可在商城消费。

**改为**（删除客户端可控的正向入账，只保留盲盒抽取扣费）：
```ts
    // ponytail: 声望/币的正向入账只允许服务端可信业务路径（任务结算、采纳、退款）触发，
    // 客户端不得自报 delta。此处仅保留盲盒抽取的固定扣费。
    const pointDelta = input.feature === 'box' && input.action === 'draw' ? -1 : 0;
```
> 若产品确实需要 `prestige/settle` 做**消耗**（负向），把最后改为 `: input.feature === 'prestige' && input.action === 'settle' ? Math.min(0, Number.isInteger(payload.delta) ? Number(payload.delta) : 0) : 0;`（只允许 ≤0）。默认取上面的纯 `-1` 版本。

**新增测试**：`server/tests/buddy-box-prestige-abuse.test.ts`
- 用 mock 的 `applyBuddyPointDelta` 依赖链断言：调用 `POST /api/buddy-box/features`，body `{feature:'prestige',action:'settle',payload:{delta:100},idempotencyKey:'k1'}`，断言**不会**发生正向 `pointTransaction`（可 spy `prisma.buddyFeatureRecord.findUnique` 返回 null、spy `$transaction`，并断言传入的 tx 上 `pointAccount.update` 未被以正 delta 调用；或更简单：断言响应 `record.result` 不含 `availablePrestige` 增加）。
- 断言 `box/draw` 仍走 `-1` 扣费路径（可 mock `pointAccount` 让扣费成功，检查 delta 为 -1）。

**验证**：`npx vitest run tests/buddy-box-prestige-abuse.test.ts` 全绿。

---

## 任务 2 · P0-2 审核前取消任务凭空退款

**文件**：`server/src/app.ts`。涉及两处。

### 2a. 退款只对"曾冻结"的任务生效
**位置**：`cancelTaskAndRefund`，约 646-650 行。

**当前**：
```ts
  async function cancelTaskAndRefund(tx: Prisma.TransactionClient, task: any, claims: Array<{ id: bigint; claimerId: bigint; frozenAmount: number }>) {
    if (task.reward > 0 && (task.taskType === 'help' || task.taskType === 'team' || task.taskType === 'reward')) {
      const refund = task.taskType === 'team' ? task.reward * task.maxClaimers : task.reward;
      await applyBuddyPointDelta(tx, task.userId, refund, `task-cancel-refund:${task.id.toString()}`, 'task_reward_refund', `取消任务退回蛋蛋币:${task.id.toString()}`);
    }
```

**改为**（增加 `task.status === 'approved'` 守卫——奖励只在审核通过时冻结，未通过的任务从未冻结，不能退）：
```ts
  async function cancelTaskAndRefund(tx: Prisma.TransactionClient, task: any, claims: Array<{ id: bigint; claimerId: bigint; frozenAmount: number }>) {
    // ponytail: 奖励币仅在任务进入 approved 时冻结（见 /tasks/:id/review），
    // 因此只有 approved 任务才有可退的冻结额。非 approved 任务退款 = 凭空发币。
    if (task.status === 'approved' && task.reward > 0 && (task.taskType === 'help' || task.taskType === 'team' || task.taskType === 'reward')) {
      const refund = task.taskType === 'team' ? task.reward * task.maxClaimers : task.reward;
      await applyBuddyPointDelta(tx, task.userId, refund, `task-cancel-refund:${task.id.toString()}`, 'task_reward_refund', `取消任务退回蛋蛋币:${task.id.toString()}`);
    }
```
> 说明：另一处调用方 `/cancellation-requests/:requestId/respond`（约 1878 行）在调用前已守卫 `task.status !== 'approved'` 直接返回（约 1873 行），因此本改动不影响该路径。claims 的 `frozenAmount` 退款（teach 学费）保持不变，那笔是真冻结。

### 2b. 冻结与退款对称：首次通过即冻结，不论审核者是谁
**位置**：`PATCH /api/tasks/:id/review` 内，约 1635-1638 行。

**当前**：
```ts
        if (input.status === 'approved' && current.userId !== currentUserId(request) && current.reward > 0 && (current.taskType === 'help' || current.taskType === 'team' || current.taskType === 'reward')) {
          const units = current.taskType === 'team' ? current.maxClaimers : 1;
          await applyBuddyPointDelta(tx, current.userId, -(current.reward * units), `task-review-freeze:${current.id.toString()}`, 'task_reward_frozen', `任务审核冻结蛋蛋币:${current.id.toString()}`);
        }
```

**改为**（用已定义的 `firstApproval`（约 1633 行 `= input.status === 'approved' && current.status !== 'approved'`）替换手写条件，并去掉"审核者非发布者才冻结"的例外——否则发布者自审时不冻结但完成仍照付，是第二个漏钱口）：
```ts
        if (firstApproval && current.reward > 0 && (current.taskType === 'help' || current.taskType === 'team' || current.taskType === 'reward')) {
          const units = current.taskType === 'team' ? current.maxClaimers : 1;
          await applyBuddyPointDelta(tx, current.userId, -(current.reward * units), `task-review-freeze:${current.id.toString()}`, 'task_reward_frozen', `任务审核冻结蛋蛋币:${current.id.toString()}`);
        }
```
> 幂等键 `task-review-freeze:${id}` 已能防重复冻结（`applyBuddyPointDelta` 命中同键即返回 duplicate，约 206-207 行），所以改成 `firstApproval` 无重复扣款风险。

**新增测试**：`server/tests/task-refund-integrity.test.ts`
- 场景 A（核心漏洞）：一个 `reward>0` 的 `reward` 型任务，`status='pending_review'`，调用 `POST /api/tasks/:id/cancel`。mock `prisma.task.findUnique` 返回该 pending_review 任务，spy `$transaction` 捕获传入 tx，断言 **`applyBuddyPointDelta` 对应的 `pointAccount.update` 从未以正 delta 被调用**（即无退款流水）。
- 场景 B（正常路径不回归）：`status='approved'` 的同类任务取消，断言退款额 = `reward`（team 型 = `reward*maxClaimers`），且重复调用 `/cancel` 幂等（第二次不再退）。

**验证**：`npx vitest run tests/task-refund-integrity.test.ts` 全绿；再 `npm test` 确认 task 相关既有测试（`task-*`、`business-contract`）未回归。

---

## 任务 3 · P0-3 前端排行榜昵称 XSS（存储型）

**文件**：`backend-handoff-package/growth-school.html`，第 7180、7196、7223、7248、7822 行；**并在 `backend-handoff-package/growth-school.rollback-real-data.html` 的对应位置同样修复**（用 grep 定位相同片段）。

**问题**：`u.name`/`user.nickname` 未转义直接拼进 `innerHTML`，注册不限字符集，可打到所有访问排行榜者（含管理员）。

**改法**：这些插值全部改用同文件已存在的 `escapeHtml()`（定义在约 4357 行）。逐处：
```js
// 7180 / 7196
html += '<div class="podium-name">' + escapeHtml(u.name) + '</div>';
// 7223 / 7248
html += '<span class="rank-name">' + escapeHtml(u.name) + '</span>';
// 7822
'<div class="gossip-top-name">' + escapeHtml(user.name) + '</div>' +
```
> 用 grep `grep -n "podium-name\|rank-name\|gossip-top-name" backend-handoff-package/*.html` 精确定位每一处（两个文件行号可能不同）。

**新增/追加测试**：在 `server/tests/frontend-ux-regressions.test.ts` 追加一个 `it`：
```ts
it('escapes leaderboard nicknames to prevent stored XSS', () => {
  expect(html).not.toMatch(/podium-name">'\s*\+\s*u\.name/);
  expect(html).not.toMatch(/rank-name">'\s*\+\s*u\.name/);
  expect(html).toContain("escapeHtml(u.name)");
});
```

**验证**：`npx vitest run tests/frontend-ux-regressions.test.ts` 全绿。

---

## 任务 4 · P0-4 `escapeInlineString` 属性逃逸（存储型 XSS，含管理员面板）

**文件**：`backend-handoff-package/growth-school.html`，函数在约 4363-4365 行；**分叉文件同改**。

**当前**：
```js
function escapeInlineString(str){
  return String(str || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r/g,'\\r').replace(/\n/g,'\\n');
}
```
只做 JS 字符串转义，但输出落在 `onclick="fn('...')"` 的双引号 HTML 属性里，未处理 `"`/`<`/`&`，用户文件名或昵称含 `"` 可注入事件处理器（`5186` 在管理员授权面板）。

**改法（一天安全版：折叠修复，一处覆盖 13 个调用点）**——先做 JS 转义，再叠加 HTML 属性转义（`&` 必须最先替换）：
```js
function escapeInlineString(str){
  return String(str || '')
    .replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r/g,'\\r').replace(/\n/g,'\\n')
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
```

**再统一 5 处手写弱转义**（第 7177、7218、7819、8329、8332 行的 `.replace(/'/g, "\\'")`），改成调用修好的 `escapeInlineString(...)`。用 grep 定位：
```bash
grep -n "replace(/'/g" backend-handoff-package/growth-school.html
```
每处 `xxx.replace(/'/g, "\\'")` → `escapeInlineString(xxx)`。

**新增测试**：在 `frontend-ux-regressions.test.ts` 追加：
```ts
it('escapeInlineString also encodes HTML attribute chars', () => {
  expect(html).toContain('.replace(/&/g,\'&amp;\').replace(/"/g,\'&quot;\')');
  expect(html).not.toMatch(/\.replace\(\/'\/g,\s*"\\\\'"\)/); // 不再有裸的手写单引号转义
});
```

**验证**：`npx vitest run tests/frontend-ux-regressions.test.ts` 全绿。

---

## 任务 5 · P0-5 分叉文件同步确认

**动作**：确认任务 3、任务 4 的修改在 `growth-school.rollback-real-data.html` 中也已应用（grep 两个文件里的关键片段，行号不同属正常）。**不要删除该文件**——在本工单最后的「交接备注」里写一句提醒人类：确认线上用哪份后，用 git 分支保存并删除冗余分叉文件。

**验证**：
```bash
grep -c "escapeHtml(u.name)" backend-handoff-package/growth-school.html backend-handoff-package/growth-school.rollback-real-data.html
grep -c "&quot;" backend-handoff-package/growth-school.html backend-handoff-package/growth-school.rollback-real-data.html
```
两文件都应 >0（若 rollback 文件本就没有排行榜/授权面板那段代码，则记录说明，不强凑）。

---

## 任务 6 · P1-1 悬赏扣款幂等键掺 `Date.now()`

**文件**：`server/src/app.ts`，`POST /api/inquiries`，约 2169-2172 行。

**当前**：
```ts
      inquiry = await prisma.$transaction(async (tx) => {
        if (input.bounty > 0) await applyBuddyPointDelta(tx, userId, -input.bounty, `inquiry-bounty:${userId.toString()}:${hashToken(input.title + input.content + String(Date.now()))}`, 'inquiry_bounty', '打听悬赏冻结');
        return tx.inquiry.create({ data: { userId, title: input.title, content: input.content, tags: input.tags, bounty: input.bounty, coinStatus: input.bounty > 0 ? 'frozen' : 'open', deadline: input.deadline ?? null } });
      });
```

**改为**（先建记录、再用稳定的 `inquiry.id` 作幂等键；去掉 `Date.now()`）：
```ts
      inquiry = await prisma.$transaction(async (tx) => {
        const created = await tx.inquiry.create({ data: { userId, title: input.title, content: input.content, tags: input.tags, bounty: input.bounty, coinStatus: input.bounty > 0 ? 'frozen' : 'open', deadline: input.deadline ?? null } });
        if (input.bounty > 0) await applyBuddyPointDelta(tx, userId, -input.bounty, `inquiry-bounty:${created.id.toString()}`, 'inquiry_bounty', '打听悬赏冻结');
        return created;
      });
```

**验证**：`npx vitest run tests/inquiry-frontend-contract.test.ts`（及任何 inquiry 相关）未回归；如无覆盖该扣款路径，追加一个断言"同一 inquiry.id 的扣款只发生一次"的小测试。

---

## 任务 7 · P1-2 登录无限流 + 限流器内存泄漏

### 7a. 登录接口加限流
**文件**：`server/src/app.ts`，`POST /api/auth/login`，约 2909 行开头。`verificationLimiter` 已在 `buildApp` 作用域内（约 310 行）。

在 `const input = parseBody(loginSchema, request.body);` 之后插入：
```ts
    const ipLimit = verificationLimiter.check(`login-ip:${request.ip}`, 20, 5 * 60 * 1000);
    const idLimit = verificationLimiter.check(`login-id:${input.identifier.toLowerCase()}`, 10, 15 * 60 * 1000);
    if (!ipLimit.allowed || !idLimit.allowed) {
      return reply.code(429)
        .header('retry-after', String(Math.max(ipLimit.retryAfterSeconds, idLimit.retryAfterSeconds)))
        .send({ error: 'RATE_LIMITED', message: '登录尝试过于频繁，请稍后再试' });
    }
```
> 说明：该窗口对成功和失败都计数，20 次/5 分钟对正常用户足够宽松，一天版可接受。

### 7b. 限流器清理空 key（内存泄漏）
**文件**：`server/src/rate-limit.ts`，`check` 方法内。

**当前**：
```ts
    entry.timestamps = entry.timestamps.filter((timestamp) => timestamp > now - windowMs);
    const allowed = entry.timestamps.length < limit;
    if (allowed) entry.timestamps.push(now);
    this.entries.set(key, entry);
```
**改为**：
```ts
    entry.timestamps = entry.timestamps.filter((timestamp) => timestamp > now - windowMs);
    const allowed = entry.timestamps.length < limit;
    if (allowed) entry.timestamps.push(now);
    // ponytail: 单机内存限流。窗口清空即回收 key，防 Map 无限增长；
    //           多实例部署需迁移到 Redis 才能全局生效。
    if (entry.timestamps.length === 0) this.entries.delete(key);
    else this.entries.set(key, entry);
```

**新增测试**：`server/tests/login-rate-limit.test.ts`——连续以错误密码打 `POST /api/auth/login` 超过 20 次（mock `prisma.user.findFirst` 返回不匹配用户），断言最终返回 429。参考 `business-contract.test.ts` 的 mock/inject 写法。

**验证**：`npx vitest run tests/login-rate-limit.test.ts` 全绿；`npm test` 确认 auth 相关未回归。

---

## 任务 8 · P1-3 / P1-4 前端两处小修 + 排查既有失败测试

### 8a. `blacklist.js:174` 数字未净化
**文件**：`backend-handoff-package/blacklist.js` 第 174 行，`(result.count || 0)` → `(Number(result.count) || 0)`。

### 8b. 盲盒 API 错误脱敏
**文件**：`backend-handoff-package/blind-box/buddy-box-api.js` 约 50 行，抛错时用的 `body.message` 未脱敏。最小改动：包一层与 `api-client.js:43` 的 `safeApiErrorMessage` 同逻辑的过滤（若含 `Prisma`/`SQL`/`.ts:`/`stack` 则替换为通用文案）。可直接内联一个小函数。

### 8c. 排查既有失败测试
`server/.vitest-full-result.json` 记录 `auth-session-flow.test.ts` 1 个失败（期望 200 得 500）。跑 `npx vitest run tests/auth-session-flow.test.ts`，读失败堆栈：
- 若是本工单改动引入的回归 → 修好。
- 若是环境/DB 相关的既有失败 → 在交接备注里如实记录原因，**不要**为了让它绿而放宽断言。
- 修完后从 git 移除 `server/.vitest-full-result.json` 这个产物并加入 `.gitignore`（`server/.vitest-full-result.json` 一行）。

**验证**：`npm test` 全绿（或仅剩已记录、与本次改动无关的既有失败）。

---

## 完成定义（DoD）· 收尾清单

- [ ] 任务 1–8 全部实施。
- [ ] 新增测试文件：`buddy-box-prestige-abuse.test.ts`、`task-refund-integrity.test.ts`、`login-rate-limit.test.ts`；`frontend-ux-regressions.test.ts` 追加 2 个 `it`。
- [ ] `cd server && npm test` 通过（除任务 8c 中已记录的、与本次无关的既有失败）。
- [ ] 未跑任何数据库迁移；未删除任何文件。
- [ ] 未改动本工单之外的代码/未整文件格式化。
- [ ] 生成一份 `docs/fix-report-2026-08-30.md`，逐条列出：每个任务改了哪些文件哪几行、新增了哪些测试、验证命令的输出摘要；并在末尾写「交接备注」：
  - 提醒人类确认线上用 `growth-school.html` 还是 rollback 文件，之后删除冗余分叉。
  - P0-1 若产品需要 `prestige/settle` 负向消耗，说明当前取的是纯 `-1` 版本，需要时按工单注释切到「只允许 ≤0」版本。
  - 任务 8c 中 `auth-session-flow.test.ts` 的最终结论。

## 建议顺序回顾
后端漏钱（任务 1、2）→ 前端 XSS（任务 3、4、5）→ 幂等/限流（任务 6、7）→ 前端小修与排查（任务 8）。每完成一个任务立即跑该任务的验证命令，绿了再继续。
