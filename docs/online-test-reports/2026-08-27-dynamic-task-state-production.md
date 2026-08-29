# 生产增量发布验收：任务事实来源第二轮

测试时间：2026-08-27 Asia/Shanghai

| 用例项 | 预期结果 | 实际结果 | 是否通过 | 问题简述 |
| --- | --- | --- | --- | --- |
| 全量回归 | 所有自动化用例通过 | 43 个文件、225 项通过 | 是 | 无 |
| 本机构建 | TypeScript 构建成功 | `npm run build` 退出 0 | 是 | 无 |
| 增量文件校验 | 本地与生产哈希一致 | `app.js`、`growth-school.html` SHA-256 一致 | 是 | 无 |
| 服务启动 | 后端正常监听 | PM2 重启后监听 `127.0.0.1:3310` | 是 | 无 |
| 公网健康检查 | health 返回 200 | `https://dsxnb.com/dd/health` 返回 200 | 是 | 无 |
| 鉴权边界 | 匿名任务查询拒绝 | `/dd/api/tasks` 返回 401 | 是 | 无 |
| 运行日志 | 无本轮服务异常 | PM2 错误日志为空 | 是 | 无 |
| Nginx | 反向代理服务可用 | `systemctl is-active nginx` 返回 active | 是 | 无 |

部署范围：仅更新 `/root/dandan-world-server-20260826-admin-fix/dist/src/app.js` 与 `/var/www/dd/growth-school.html`。未执行服务器构建、依赖安装、数据库迁移或商城启用。回滚目录：`/root/deploy-backups/dynamic-task-state-20260827-0441`。

## 补充发布：管理员任务描述必填

测试时间：2026-08-27 Asia/Shanghai

| 用例项 | 预期结果 | 实际结果 | 是否通过 | 问题简述 |
| --- | --- | --- | --- | --- |
| 全量回归 | 所有自动化用例通过 | 43 个文件、226 项通过 | 是 | 无 |
| 管理员任务输入 | 空描述不产生固定示例内容 | 前端将描述作为必填字段校验 | 是 | 无 |
| 增量文件校验 | 本地与生产哈希一致 | `growth-school.html` SHA-256 一致 | 是 | 无 |
| 公网健康检查 | health 返回 200 | `https://dsxnb.com/dd/health` 返回 200 | 是 | 无 |
| 鉴权边界 | 匿名任务查询拒绝 | `/dd/api/tasks` 返回 401 | 是 | 无 |
| 运行状态 | Nginx 与后端正常 | Nginx active，`dandan-world` online，错误日志为空 | 是 | 无 |

部署范围：仅更新 `/var/www/dd/growth-school.html`。未执行服务器构建、依赖安装、数据库迁移或商城启用。回滚副本：`/root/deploy-backups/admin-task-description-20260827-045102/growth-school.html`。

## 补充发布：反馈工单前端控制器

测试时间：2026-08-27 Asia/Shanghai

| 用例项 | 预期结果 | 实际结果 | 是否通过 | 问题简述 |
| --- | --- | --- | --- | --- |
| 失败回归 | 缺失反馈处理函数能被定位 | 新契约先失败，确认可见反馈控件无绑定实现 | 是 | 已修复 |
| 全量回归 | 所有自动化用例通过 | 43 个文件、227 项通过 | 是 | 无 |
| 反馈连接契约 | 用户/管理员反馈操作均走既有 REST API | 18 项生产前端契约通过 | 是 | 无 |
| 脚本解析 | 页面脚本可执行 | 两段内联脚本解析成功 | 是 | 无 |
| 静态可达性 | 页面调用和控件处理器都存在 | 78 个 API 调用、180 个内联处理器无缺失 | 是 | 无 |
| 增量文件校验 | 本地与生产哈希一致 | `growth-school.html` SHA-256 一致 | 是 | 无 |
| 公网健康检查 | health 返回 200 | `https://dsxnb.com/dd/health` 返回 200 | 是 | 无 |
| 鉴权边界 | 匿名任务查询拒绝 | `/dd/api/tasks` 返回 401 | 是 | 无 |
| 运行状态 | Nginx 与后端正常 | Nginx active，`dandan-world` online，错误日志为空 | 是 | 无 |

部署范围：仅更新 `/var/www/dd/growth-school.html`。未执行服务器构建、依赖安装、数据库迁移或商城启用。回滚副本：`/root/deploy-backups/feedback-ui-20260827-050757/growth-school.html`。

最终微调：将“已回复”标签改为按服务端管理员消息实际数量统计，而非以处理中状态代替。定向契约与页面脚本复验通过；最终页面 SHA-256 为 `9900DE6A1E31175A927D3CCA9B5C291AC9AF6D9465DC307A6BB4AF1B772558E0`，公网页面 200、health 200、匿名任务接口 401，Nginx active，PM2 `dandan-world` online，错误日志为空。最终回滚副本：`/root/deploy-backups/feedback-ui-label-20260827-051046/growth-school.html`。

## 前端任务历史分支清理发布

测试时间：2026-08-27 Asia/Shanghai

| 用例项 | 预期结果 | 实际结果 | 是否通过 | 问题简述 |
| --- | --- | --- | --- | --- |
| 本地伪造任务分支 | 不保留 DOM-only 造任务/删任务函数 | `addToMyTasks`、`deleteMyTask`、`deleteGroup` 均已移除 | 是 | 无 |
| 定向契约 | 本轮相关任务契约均通过 | 3 个文件、28 项通过 | 是 | 初始失败由 CRLF/LF 测试边界不兼容引起，已最小修复 |
| 全量回归 | 所有自动化用例通过 | 43 个文件、228 项通过 | 是 | 无 |
| 本机构建 | TypeScript 构建成功 | `npm run build` 退出 0 | 是 | 无 |
| 发布边界 | 仅前端静态页发生变化 | 仅增量上传 `growth-school.html`，未上传数据库、商城或环境文件 | 是 | 无 |

## 发布结果

| 用例项 | 预期结果 | 实际结果 | 是否通过 | 问题简述 |
| --- | --- | --- | --- | --- |
| 增量上传 | 生产仅替换目标静态页 | `/var/www/dd/growth-school.html` 已替换，SHA-256 与本地 `7EE69EC6580208B4814791C02BF556B169BE3B0D272A7C69750A92FFF6939CA9` 一致 | 是 | 无 |
| 回滚保护 | 覆盖前保留可恢复副本 | `/root/deploy-backups/task-history-cleanup-20260827-052243/growth-school.html` | 是 | 无 |
| 公网健康检查 | health 返回 200 | `https://dsxnb.com/dd/health` 返回 200 | 是 | 无 |
| 鉴权边界 | 匿名任务查询返回 401 | `https://dsxnb.com/dd/api/tasks` 返回 401 | 是 | 无 |
| 运行状态 | Nginx、PM2 正常且本轮无新错误 | Nginx active，`dandan-world` online，当前进程最近 500 行无 5xx，错误日志为空 | 是 | 历史日志保留旧记录，未计入本轮 |
