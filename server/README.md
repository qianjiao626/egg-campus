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

## 安全要求

- MySQL 只监听本机或 CVM 内网地址，公网访问应通过后端 API。
- 应用账号不能使用 root，生产连接串不能提交到 Git。
- 使用强密码、最小权限账号和定期备份。
- 先在测试库执行迁移并演练恢复，再执行生产迁移。
- 验证码默认使用 Mock provider；生产启用腾讯云短信时必须配置全部 `TENCENT_*` 环境变量，缺失配置会阻止启动。
- 服务进程每 15 分钟清理过期验证码；清理失败只记录 provider/数据库错误，不会记录验证码内容。

## 当前边界

任务、认领、评价、通知和自动退款尚未接入。这些模块应在用户身份、账户余额和流水经过测试后再开发。
# 数据库边界

本服务属于“蛋蛋校园”项目，使用南京 CVM 本机 MariaDB/MySQL 数据库 `dandan_world`。
它不读取、不迁移、不修改“航线”项目的 Supabase 数据库；部署时只使用本目录的 `.env` 中的 `DATABASE_URL`。
