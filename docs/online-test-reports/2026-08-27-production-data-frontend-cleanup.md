# 蛋蛋校园前端演示数据清理发布报告

- 记录时间：2026-08-27 05:53:56 +08:00（本机验证阶段）
- 发布边界：仅 `growth-school.html` 与 `blind-box/app.js`；不执行服务器 build、不运行商城迁移、不修改 `.env`、不触碰“航线”或 Supabase。
- 验证方式：本机 PowerShell、Vitest、TypeScript 编译和 Node 脚本解析；禁止浏览器/WebShell/截图。

| 测试时间 | 用例项 | 预期结果 | 实际结果 | 是否通过 | 问题简述 |
| --- | --- | --- | --- | --- | --- |
| 2026-08-27 05:52 | 全量后端/契约回归 | 所有测试通过 | 43 个测试文件、233 项测试通过 | 通过 |  |
| 2026-08-27 05:52 | TypeScript 构建 | 本机构建成功 | `npm run build` exit 0 | 通过 |  |
| 2026-08-27 05:53 | 外部前端脚本语法 | JS 无语法错误 | `api-client.js`、盲盒 `app.js`、`realtime-client.js` 均通过 `node --check` | 通过 |  |
| 2026-08-27 05:53 | 主页面内联脚本语法 | 两段脚本可解析 | `INLINE_SCRIPTS_OK=2` | 通过 |  |
| 2026-08-27 05:53 | 固定演示数据禁入检查 | 禁止标记全部不存在 | 11 类标记全部 `CLEAR` | 通过 |  |
| 2026-08-27 05:56 | 生产文件备份与增量发布 | 先备份，再只覆盖两个变化文件 | 回滚目录 `/root/deploy-backups/frontend-real-data-20260827-055608`；仅上传主页面和盲盒脚本 | 通过 | 未重启后端、未修改数据库或环境变量 |
| 2026-08-27 05:57 | 生产文件哈希 | 本机、远端正式文件及公网下载一致 | 主页面 `74350765...AF2ED`；盲盒脚本 `658032A5...636FD`，三处一致 | 通过 |  |
| 2026-08-27 05:57 | 公网 health/鉴权 | health=200，匿名任务=401 | `GET /dd/health` 返回 200 与 `status=ok`；匿名任务返回 401 中文提示 | 通过 |  |
| 2026-08-27 05:58 | Nginx/PM2 | Nginx active、PM2 online | Nginx `active`；`dandan-world` `online`，PID 2477809，unstable restarts 0 | 通过 | 静态更新无需重启进程 |
| 2026-08-27 05:59 | 当前进程错误日志 | 无发布后 level 50 或 HTTP 5xx | PM2 error log 为空；当前 PID 日志无 level 50/5xx | 通过 | 历史旧 PID 曾有商城维护错误，本轮按当前 PID 排除，商城继续关闭 |

## 2026-08-27 06:09 运行时残留清理增量发布

| 测试时间 | 用例项 | 预期结果 | 实际结果 | 是否通过 | 问题简述 |
| --- | --- | --- | --- | --- | --- |
| 2026-08-27 06:08 | 任务完成链路契约 | 提交记录、完成结算、评价均调用后端接口 | 新增契约通过；`taskClaims` -> `completeTask` -> `rateTask` 链路存在 | 通过 |  |
| 2026-08-27 06:08 | 客户端运行时残留 | 不调用已删除函数，不保留 DOM-only 转账 | `scanAndRefundExpiredTasks`、`teamConfirmComplete`、`teamPublisherConfirm` 均无命中 | 通过 |  |
| 2026-08-27 06:09 | 生产哈希 | 本机与远端正式文件一致 | `growth-school.html` SHA-256 `8453F922...8573A` | 通过 |  |
| 2026-08-27 06:09 | 公网服务验收 | health=200、匿名任务=401 | health 200；匿名任务 401；Nginx active；PM2 online | 通过 |  |
| 2026-08-27 06:09 | 当前进程日志 | 无新增 level 50 或 HTTP 5xx | error log 0 字节；当前 PID 日志仅健康/鉴权成功响应 | 通过 |  |

## 2026-08-27 06:31 个人评价动态化增量发布

- 发布边界：`server/dist/src/app.js`、`backend-handoff-package/api-client.js`、`backend-handoff-package/growth-school.html`。
- 回滚目录：`/root/deploy-backups/profile-ratings-20260827-062009`。
- 约束：服务器不 build、不安装依赖、不修改 `.env`、不执行 Prisma 迁移；商城继续关闭。

| 测试时间 | 用例项 | 预期结果 | 实际结果 | 是否通过 | 问题简述 |
| --- | --- | --- | --- | --- | --- |
| 2026-08-27 06:32 | 完整自动化回归 | 所有后端与前端契约通过 | 43 个测试文件、239 项测试通过 | 通过 |  |
| 2026-08-27 06:33 | 本机构建与脚本解析 | 构建成功、JS 可解析 | `npm run build` exit 0；`api-client.js`、后端构建脚本均通过 `node --check`，产物哈希未变化 | 通过 |  |
| 2026-08-27 06:20 | 发布前备份 | 三个旧生产文件可回滚 | 已保存至 `/root/deploy-backups/profile-ratings-20260827-062009` | 通过 |  |
| 2026-08-27 06:24 | 上传与正式文件哈希 | 本机、临时上传和正式路径哈希一致 | 后端 `8B21BCED...BB77A2`；API 客户端 `3F1E6DB4...D6565`；主页面 `3E609412...EA0` | 通过 |  |
| 2026-08-27 06:25 | 后端进程启动 | 新构建正常监听且无不稳定重启 | PM2 `dandan-world` PID `2506329` online；监听 `127.0.0.1:3310`；unstable restarts 0 | 通过 |  |
| 2026-08-27 06:26 | 公网健康与匿名鉴权 | health 200；受保护接口匿名 401 | `/dd/health` 200；`/dd/api/tasks` 401；`/dd/api/users/me/ratings` 401 | 通过 | 已认证评价接口未使用明文生产凭据执行；本地授权契约已覆盖 |
| 2026-08-27 06:27 | Nginx | 配置有效且进程 active | `nginx -t` 成功；`systemctl is-active nginx` 返回 `active` | 通过 |  |
| 2026-08-27 06:29 | 公网前端版本与哈希 | 主页面加载新客户端且内容与本机一致 | 主页面 200，包含 `20260827-ratings`；两个公网文件 SHA-256 与本机一致 | 通过 |  |
| 2026-08-27 06:30 | 当前进程错误检查 | 无 MySQL 1045、Prisma 初始化错误、level 50 或 HTTP 5xx | PM2 error log 0 字节；PID `2506329` 的 fatal/5xx 命中为 0 | 通过 |  |
