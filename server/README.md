# 蛋蛋世界后端一期

这是用户数据和认证 API 的第一期后端骨架，数据库使用南京 CVM 上自托管的 MariaDB 10.3（MySQL 兼容协议）。

## 本地或 CVM 启动

```powershell
cd server
Copy-Item .env.example .env
# 编辑 .env，填写真实 DATABASE_URL 和至少 32 位 JWT_SECRET
npm install
npm run prisma:generate
npm run prisma:deploy
npm run dev
```

如果后端和 MySQL 在同一台 CVM，`DATABASE_URL` 使用 `127.0.0.1:3306`。如果后端部署在另一台服务器，才使用 CVM 内网地址，并配置安全组；不要公开暴露 MySQL 3306 端口。

## 已提供接口

- `GET /health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/verification-codes`
- `POST /api/auth/verification-codes/verify`
- `POST /api/auth/password-reset/request`
- `POST /api/auth/password-reset/confirm`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/users/me`
- `PUT /api/users/me`
- `GET /api/users/me/stats`
- `GET /api/users/me/characters`
- `PUT /api/users/me/characters/current`
- `GET /api/users/me/point-account`
- `GET /api/users/me/point-transactions`
- `GET /api/users/:id/public-profile`
- `GET /api/tasks/claimed`
- `GET /api/feedback/mine`
- `POST /api/feedback/:id/messages`
- `POST /api/feedback/:id/reopen`
- `POST /api/feedback/:id/attachments`
- `GET /api/feedback/:id/attachments/:attachmentId`
- `GET /api/admin/permissions`
- `GET|POST|PATCH /api/admin/roles`
- `POST /api/admin/role-grants`
- `POST /api/admin/role-grants/:id/revoke`
- `GET /api/admin/role-grant-audit`

## 安全要求

- MySQL 只监听本机或 CVM 内网地址，公网访问应通过后端 API。
- 应用账号不能使用 root，生产连接串不能提交到 Git。
- 使用强密码、最小权限账号和定期备份。
- 先在测试库执行迁移并演练恢复，再执行生产迁移。
- 当前验证码 provider 使用 `disabled`；登录仅支持邮箱或昵称。手机号字段保留用于历史资料兼容，但不参与登录或短信验证。
- 服务进程每 15 分钟清理过期验证码；清理失败只记录 provider/数据库错误，不会记录验证码内容。
- 反馈附件目录由 `FEEDBACK_ATTACHMENT_ROOT` 指定，必须位于 Nginx 静态目录之外，目录权限建议 `0700`。
- 固定管理员初始化与回滚步骤见 `docs/rbac-seed-runbook.md`；临时密码只能在交互式终端隐藏输入。

## 当前边界

任务、认领、评价、通知、打听、反馈时间线、反馈附件和 RBAC 已接入。生产迁移前仍需执行完整测试、备份和恢复演练。
# 数据库边界

本服务属于“蛋蛋校园”项目，使用南京 CVM 本机 MariaDB/MySQL 数据库 `dandan_world`。
它不读取、不迁移、不修改“航线”项目的 Supabase 数据库；部署时只使用本目录的 `.env` 中的 `DATABASE_URL`。
