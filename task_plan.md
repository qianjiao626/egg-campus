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
| 6 | 任务、蛋蛋币、评价和通知闭环 | pending |
| 7 | 测试、备份、监控和上线验收 | pending_backup_monitoring |

## 当前下一步

下一步：配置腾讯云 SMS 真实 provider（当前按用户要求暂保留 Mock），在 CVM 会话恢复后执行 `server/deploy/backup-dandan-world.sh` 并完成临时库恢复演练。监控、回滚操作说明已写入 `docs/production-operations.md`。盲盒交友已发布到 `https://dsxnb.com/dd/blind-box/`，API 使用独立 `buddy_*` 表；PM2 已加载远程 `.env` 并接管 `127.0.0.1:3310`；“航线”根站保持原配置。

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
