# 蛋蛋校园 · 收尾工单（Codex 专用）· 2026-08-30 第二轮

> 上一轮（`docs/codex-oneday-plan-2026-08-30.md`）已完成并复核通过。本工单只做收尾：2 个代码任务 + 1 份交接文档。
> 规则不变：不跑 `prisma migrate`，不删文件，不整文件格式化，只改点名位置。测试在 `server/` 目录 `npx vitest run` 验证。

---

## 任务 1 · 修抖动测试超时

**文件**：`server/tests/required-password-change.test.ts` 第 16 行。

**问题**：该测试单跑通过，全量并发跑时偶发超 5 秒默认超时（bcrypt cost 12 抢 CPU），与业务无关。

**改法**：给该 `it` 加超时参数（vitest 语法，第三个参数）：

```ts
it('blocks normal APIs and revokes other sessions after changing the temporary password', async () => {
  // ...原有内容不动...
}, 20000);
```

**禁止**：不许放宽任何断言，不许 mock 掉 bcrypt。只加超时。

**验证**：
```bash
cd server
npx vitest run tests/required-password-change.test.ts   # 绿
npx vitest run                                          # 全量 372 个全绿
```

---

## 任务 2 · 提交代码

全量测试绿了之后，把当前工作区所有修改与新增文件提交（新文档、迁移目录、新测试都要包含）：

```bash
git add -A
git commit -m "fix: close coin-mint/refund exploits, stored XSS, login rate limit + idempotent inquiry bounty

- remove client-controlled prestige/settle credit path (infinite mint)
- gate task reward refunds on explicit rewardFrozen state; freeze on first approval regardless of reviewer
- escape leaderboard names + harden escapeInlineString for attribute context (both HTML variants)
- rate limit /api/auth/login by IP and identifier; rate limiter frees empty keys
- stable idempotency key for inquiry bounty (client uuid or payload hash, P2002-safe)
- sanitize blind-box API error messages; Number() guard in blacklist count
- add regression tests: prestige abuse, refund integrity, login rate limit, inquiry idempotency, XSS escapes"
```

不要 push，push 留给人类。

---

## 任务 3 · 写部署交接文档

新建 `docs/deploy-checklist-2026-08-30.md`，内容如下（原样写入，人类照着做）：

```markdown
# 部署清单 · 2026-08-30 安全修复版

## ⚠️ 顺序硬约束：先迁移，后发代码

本版代码引用两个新数据库列，生产库尚不存在。顺序反了，任务审核/取消
和发布打听会直接 500。

1. 备份数据库。
2. 服务器上执行迁移：
   cd server && npx prisma migrate deploy
   预期应用两个迁移：
   - 202608300002_task_reward_frozen   （tasks.reward_frozen 列）
   - 202608300003_inquiry_idempotency_key（inquiries.idempotency_key 列 + 唯一索引）
3. 确认迁移成功后再部署新版 server 代码并重启（pm2）。
4. 部署新版前端文件（growth-school.html 等），
   发布前更新 release manifest 中 growth-school.html 与 app.ts 的 sha256。

## 存量数据说明

已存在的 approved 且 reward>0 的任务，reward_frozen 默认为 false，
它们的奖励其实冻结过。若线上有这类进行中任务，迁移后补一条 SQL：
  UPDATE tasks SET reward_frozen = true
  WHERE status = 'approved' AND reward > 0
    AND task_type IN ('help','team','reward') AND completed_at IS NULL;
否则这批任务取消时不退款（少退，不多发，方向安全，但用户会投诉）。

## 部署后人工验证

- 错误密码连打 11 次 /api/auth/login，第 11 次应返回 429 + retry-after。
- 建一个 reward>0 的任务，审核通过前取消，发布者余额应不变。
- 审核通过后取消，余额应退回且只退一次。
- 把测试账号昵称设为 <img src=x onerror=alert(1)>，打开排行榜应显示纯文本。
- 发布带悬赏的打听，确认只扣一次币。

## 遗留决策（不阻塞本次上线）

- 确认线上用 growth-school.html 还是 rollback 文件后，删除冗余分叉（git 分支留档）。
- prestige/settle 现已无入账路径；若产品需要负向消耗玩法，按
  docs/codex-oneday-plan-2026-08-30.md 任务 1 注释切「只允许 ≤0」版本。
- 老前端缓存页不带 idempotencyKey 重发相同内容的打听会拿回旧记录
  （duplicate:true）而非新建，属已知取舍。
```

---

## 完成定义

- [ ] 任务 1 改完，全量 `npx vitest run` 372 个全绿。
- [ ] 任务 2 提交完成（不 push）。
- [ ] 任务 3 文档已写入 `docs/deploy-checklist-2026-08-30.md`。
- [ ] 未跑迁移、未删文件、未动工单外代码。
