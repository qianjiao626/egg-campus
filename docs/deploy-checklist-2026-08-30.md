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
