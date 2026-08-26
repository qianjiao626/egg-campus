# 蛋蛋世界：腾讯云 MySQL 数据库建设计划

## 目标

建立可用于生产演进的 CVM 自托管 MySQL 数据层，先安全保存用户数据，再逐步接入任务、蛋蛋币、评价、通知和管理后台。前端只通过后端接口访问数据库，不允许浏览器直连数据库。

## 方案假设

- 数据库：南京 CVM 上自托管 MySQL 8.0，InnoDB，UTF8MB4。
- 访问方式：后端服务和数据库在同一台 CVM，使用 `127.0.0.1:3306`。
- 认证：后端使用密码哈希、会话/JWT 和服务端权限校验。
- 一期范围：用户注册/登录、用户资料、五维统计、角色解锁、蛋蛋币账户及流水。
- 二期范围：任务、认领配对、提交验收、评价、通知、反馈和自动退款。

## 阶段

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0 | 需求冻结与领域规则确认 | completed |
| 1 | 腾讯云资源、网络和安全配置 | dd_subpath_nginx_and_https_proxy_completed_sms_pending |
| 2 | 数据库 Schema、迁移和种子数据 | completed |
| 3 | 用户数据 API 与认证 | completed_cvm_dd_smoke_passed |
| 4 | 前端数据层接入与兼容迁移 | completed_dd_static_deployed_browser_verified |
| 5 | 盲盒交友模块与用户认证接入 | completed_cvm_and_dd_deployed |
| 6 | 任务、蛋蛋币、评价和通知闭环 | completed_local |
| 7 | 测试、备份、监控和上线验收 | local_verification_complete_cvm_pending |

## 当前下一步

下一步：在 CVM 会话恢复后先执行 `server/deploy/backup-dandan-world.sh`，再逐步执行 `prisma migrate deploy`、构建、PM2 重启、日志和 `/health` 检查，并接入受保护定时调用 `POST /api/admin/inquiries/refund-expired`。监控、回滚操作说明已写入 `docs/production-operations.md`。本地最终收口包为前端 r8、后端 r7；生产仍需按单步流程验收，未宣称本轮上线。“航线”根站和 Supabase 配置保持隔离。

## 2026-08-26 收口状态更新

- [x] 盲盒收件箱/会话 HTTP 轮询已接入，并在关闭窗口时清理定时器。
- [x] 本地回归：53 个测试通过、TypeScript 构建通过、Prisma schema 校验通过、前端脚本和内联脚本语法通过。
- [x] 390x844、768x1024、1440x900 三端无横向溢出，盲盒直达页仅输出内容组件。
- [x] 前端 r8 与后端 r7 压缩包已生成并完成 SHA-256、文件数量和禁入文件检查。
- [ ] 恢复可验证 CVM 会话后，按备份 -> 迁移 -> 构建 -> PM2 日志 -> `/health` -> 三端线上 smoke 执行生产发布。

## 2026-08-26 四项 Bug 修复

- [x] 注册表单和登录兼容策略
- [x] 任务每日发布上限与递减经验结算
- [x] 新用户静态任务隔离
- [x] 真实用户排行榜与八卦榜聚合
- [x] 测试、构建、Prisma 生成和文档记录
- [ ] CVM 生产发布与线上 smoke（等待 MFA）

## 验收总标准

- 用户注册、登录、退出和资料更新可持久化。
- 余额、冻结余额和流水在事务中保持一致，重复请求不会重复扣款。
- 任务状态只能通过合法状态转移改变。
- 关键权限、隐私字段和管理员操作由后端校验。
- 备份恢复、监控告警和回滚步骤经过演练。

## 已完成的本地搭建

- `server/` Node.js + TypeScript + Fastify 后端工程
- Prisma MySQL schema 和初始用户数据迁移
- 用户、会话、五维统计、角色、蛋蛋币账户、蛋蛋币流水、审计日志模型
- 注册、登录、退出、个人资料、角色、蛋蛋币账户和流水 API
- 输入校验、密码哈希、JWT 会话、公开资料脱敏
- 单元测试、健康检查测试和构建脚本
- 本地认证回归：6 个测试文件、19 个测试通过；TypeScript 构建通过
- 可重复的 CVM 构建、Prisma 迁移和健康检查脚本 `server/cvm-deploy.sh`
- `https://dsxnb.com/dd/` 子目录部署：静态文件 `/var/www/dd`，API `/dd/api` 代理到 `127.0.0.1:3310`
- `https://dsxnb.com/dd/health` 作为公开 API 健康检查入口，代理到 `127.0.0.1:3310/health`
- `https://dsxnb.com/dd/blind-box/` 盲盒交友静态模块，使用现有蛋蛋校园登录会话和 `dandan_world` 独立表
- 盲盒 API 线上验证：未登录 `GET /dd/api/buddy-box/recommendations` 返回 `401`；`/dd/health` 返回 `200`
- PM2 `dandan-world` 已修复环境变量注入并保存进程清单，避免重启后因缺少 `DATABASE_URL`/`JWT_SECRET` 退出
- `server/deploy/backup-dandan-world.sh`、`server/deploy/verify-backup.sh` 和 `docs/production-operations.md` 已加入；远程实际备份尚待 MFA 会话恢复后执行并验证
- 已将验证通过的 `index.html`、`app.js` 和 `buddy-box-api.js` 同步回原始 `D:\桌面文件\盲盒交友模块`，后续从该模块继续开发不会丢失认证/API 接入
- CVM 新版本目录 `/root/dandan-world-server-20260823220500`，旧版本目录保留用于回滚
- 公开子目录认证烟测输出 `AUTH_SMOKE_OK`

## 2026-08-26 本轮收口状态

- 本地完成：真实蛋蛋币流水查询、打听专属列表、回答采纳事务结算与通知、盲盒错误提示、学校/地区/任务联系方式敏感词校验。
- 本地验证完成：后端 47 项测试、TypeScript 构建、前端三个脚本和主站内联脚本语法、浏览器访客首屏与盲盒纯内容 smoke。
- 交付包已更新为 `output/releases/*20260826-business-iteration-r2.zip`，已做 SHA-256 和禁入文件边界检查。
- 生产状态保持待执行：备份 -> Prisma migrate deploy -> 构建 -> PM2 日志 -> `/health` -> 三端线上 smoke；未获得可验证 CVM shell 前不得宣称上线。

## 2026-08-26 本轮增量任务

| 项目 | 状态 | 说明 |
|---|---|---|
| 今日盲盒行动参与推荐排序 | completed_local | 推荐 API 接收可选 `action`，按 `todayActions` 同值/包含关系提升命中用户；抽盒揭示后前端刷新推荐 |
| 自动化契约 | completed_local | 后端排序契约、前端连接点契约均已先红后绿 |
| 生产发布 | pending_cvm | 仍需恢复可验证 CVM 会话后按备份、迁移核对、构建、PM2 日志、health 和三端 smoke 执行 |

## 2026-08-26（敏感词与盲盒本地开发收口）

- [x] 对盲盒高级玩法嵌套 JSON 接入服务端递归敏感词校验。
- [x] 对注册、资料、反馈字段补齐服务端敏感词校验；用户可见提示不展示具体敏感词。
- [x] 修正盲盒本地 API origin，并去除高级玩法无记录时的伪造数据兜底。
- [x] 完成本地后端 55 项测试、构建、Prisma、脚本语法、差异和三视口组件结构检查。
- [ ] CVM 会话恢复后先备份生产数据库，再逐条执行迁移、构建、PM2 日志、`/health` 和三端公网 smoke；未完成前不得标记上线。

## 2026-08-26（盲盒真实结果与交付）

- [x] 移除雷达和破冰助手的固定服务端结果伪造，改为真实空状态。
- [x] 好友申请事务补充双方用户行锁，保留既有关系状态与拒绝冷却规则。
- [x] 重新完成构建、Prisma、55 项测试、前端语法、差异和三端组件结构验证。
- [x] 已生成并核验前端 r10、后端 r9 交付包：18/46 文件，禁入文件 0，SHA-256 已写入验证记录。
- [ ] 恢复可验证 CVM 会话后，按备份 -> 迁移 -> 构建 -> PM2 日志 -> `/health` -> 公网 smoke 发布。

## 2026-08-26（我的打听与真实发布数据收口）

- [x] `/api/inquiries/mine` 增加当前用户专属的回复总数和最新回复摘要，保留原字段且不改表。
- [x] 打听页“我的打听”面板改用服务端专属汇总，不再从全站数据模拟消息汇总。
- [x] 普通用户发布任务取消开发示例文本兜底，空标题或描述不发起写库请求。
- [x] 已完成 58 项全量测试和 TypeScript 构建。
- [x] 已生成并核验前端 r11、后端 r10 包：18/46 文件、禁入项 0，SHA-256 已写入验证记录。
- [ ] CVM 恢复可验证会话后，严格按备份 -> 迁移状态核对 -> 构建 -> PM2 日志 -> `/health` -> 三端公网 smoke 发布。

## 2026-08-26（关机恢复后的工具链修复）

- [x] 恢复 Codex 本地执行宿主并确认命令执行可用。
- [x] 修复 agent-browser Windows 冷启动配置，专用 Chrome 自动启动、连接、快照和截图均已验证。
- [x] 清理不完整的 `animation-systems.partial-install` 遗留目录。
- [x] 新增 `docs/skills-healthcheck.ps1`，验证 74 个 Codex skill、57 个 Agents skill、5 个官方插件 manifest 和 agent-browser 配置。
- [x] 工具链验收输出 `SKILLS_HEALTH_OK`；生产发布状态保持未上线，避免把工具恢复误报为业务发布完成。
