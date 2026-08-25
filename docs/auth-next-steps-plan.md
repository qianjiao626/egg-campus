# 蛋蛋校园认证系统：当前评估与后续实施计划

更新日期：2026-08-23

## 1. 当前结论

蛋蛋校园**不是还没有注册登录系统**。当前状态应区分为“代码已完成”和“上线已完成”：

| 能力 | 当前状态 | 说明 |
|---|---|---|
| 账号密码登录 | 已实现 | 支持邮箱、手机号或昵称作为登录标识 |
| 注册 | 已实现 | 注册前必须完成手机号/邮箱验证码验证 |
| 验证码发送 | 已实现并通过 CVM Mock 烟测 | 之前的 500 是终端输入 JSON 被破坏；使用正确 JSON 后返回 202 |
| 验证码校验 | 已实现代码 | 6 位、哈希存储、5 分钟过期、单次消费、错误次数限制 |
| 退出登录 | 已实现 | 撤销服务端会话，并清理 refresh cookie |
| 刷新登录状态 | 已实现 | refresh token 轮换，旧 token 不应重复使用 |
| 找回密码 | 后端已实现，前端入口已接入 | 已修复确认 schema 不应要求客户端传 `purpose`；修复需在 CVM 重启后重新烟测 |
| 前端真实 API 接入 | 已实现并有契约测试 | 已移除 Demo 用户表、localStorage 和 Supabase 依赖 |
| CVM 数据库迁移 | 已完成 | 使用独立的 `dandan_world` MariaDB；与“航线” Supabase 隔离 |
| 生产短信 | 未完成 | 尚未配置腾讯云短信密钥、签名和模板 |
| 生产发布 | 未完成 | 需要修复验证码 500、HTTPS、Cookie 安全配置、进程守护和最终回归 |

因此，当前阶段是：**认证功能已搭建，正在进行 CVM 联调和上线前验收，不应直接宣布生产可用。**

## 2. 已有接口范围

- `POST /api/auth/verification-codes`：申请验证码
- `POST /api/auth/verification-codes/verify`：校验验证码并获取一次性验证 token
- `POST /api/auth/register`：创建账户并自动建立登录会话
- `POST /api/auth/login`：账号密码登录
- `POST /api/auth/refresh`：刷新 access token，并轮换 refresh token
- `POST /api/auth/logout`：撤销当前会话
- `POST /api/auth/password-reset/request`：申请找回密码验证码
- `POST /api/auth/password-reset/confirm`：使用验证 token 设置新密码
- `GET /api/users/me`：读取当前用户资料
- `PUT /api/users/me`：更新当前用户资料
- `GET /api/users/me/stats`、`/characters`、`/point-account`、`/point-transactions`：读取用户业务数据

## 3. 接下来按优先级执行

### P0：修复 CVM 验证码 500，恢复可验收状态

1. 查看 `/root/dandan-world-server.log` 完整堆栈，确认真实异常，而不是只看 500 响应。已确认旧 500 为手工终端请求的 `FST_ERR_CTP_INVALID_JSON_BODY`。
2. 检查 CVM `.env` 的非敏感配置：端口、provider、Cookie 开关和安全标志。
3. 检查 `verification_codes` 表结构、索引和应用账号权限，与 Prisma schema 对照。
4. 检查服务使用的部署目录、生成的 Prisma Client 和数据库连接串是否一致。
5. 修复后先用 `VERIFICATION_PROVIDER=mock` 完成验证码发送/验证，再继续注册流程。已用无歧义 JSON 请求验证返回 202。

**验收标准：**验证码接口返回 202；数据库只保存 `code_hash`；错误、过期、重复使用和超次数输入均返回预期错误；日志不出现验证码明文。已完成接口 202 和本地哈希/错误规则测试。

### P0：完成 CVM 认证全链路烟测

依次验证：健康检查 -> 申请验证码 -> 验证验证码 -> 注册 -> `/api/users/me` -> 刷新 -> 旧 refresh token 失效 -> 退出 -> 已退出 token 失效 -> 找回密码 -> 旧会话全部失效。

**验收标准：**`server/cvm-auth-smoke.sh` 全部通过；测试用户和测试验证码清理；`dandan_world` 中无残留 smoke 数据。注册、刷新、资料读取、退出核心流程已通过（`AUTH_SMOKE_OK`）；扩展流程已定位到确认 schema 问题并在本地修复，CVM 仍需重启新构建后复测。

### P1：接入腾讯云 SMS 生产 provider

1. 创建仅具短信发送权限的腾讯云子账号或 API 密钥。
2. 准备已审核的短信签名、模板和模板参数（验证码、有效期）。
3. 仅在 CVM `.env` 配置 `TENCENTCLOUD_*`、`TENCENT_SMS_*`，不写入源码、压缩包或聊天。
4. 先在受限测试手机号上验证发送记录、错误码和频率限制。
5. 确认收不到短信时前端显示可理解的失败提示，后端不泄露 provider 密钥和验证码。

**验收标准：**真实手机收到短信；腾讯云发送记录成功；provider 缺配置时服务启动失败；Mock 不会被误用于生产。

### P1：完成前端认证体验和浏览器回归

1. 验证登录、注册、获取验证码倒计时、确认密码、错误提示和加载状态。
2. 增加找回密码入口和完整页面流程（请求验证码、验证、设置新密码）。
3. 检查刷新页面后的会话恢复策略，确保 access token 不写入 localStorage。
4. 检查手机宽度布局、输入框可访问名称、按钮禁用状态和重复点击防护。
5. 用浏览器测试桌面和移动宽度，确认游客任务广场和登录后数据仍正常。

**验收标准：**浏览器 smoke 流程通过；不再读取 `REGISTERED_USERS`、Demo 密码或 Supabase；刷新/退出行为与后端一致。

### P1：生产会话和网络安全配置

1. 配置正式域名和 HTTPS 反向代理。
2. 正式环境设置 `COOKIE_SECURE=true`、HttpOnly、SameSite 和明确 CORS origin。
3. API 仅监听本机或受限内网；MariaDB 继续只监听 `127.0.0.1:3306`，不开放公网 3306。
4. 使用 systemd 或 PM2 守护进程，配置自动重启、日志轮转和健康检查。
5. 为 JWT secret、数据库密码和短信密钥建立轮换记录。

**验收标准：**HTTPS 下 Cookie 带 Secure；跨域仅允许正式前端域名；服务重启后自动恢复；公网扫描看不到数据库端口。

### P2：备份、监控和发布回滚

1. 在迁移和正式发布前备份 `dandan_world`，记录备份位置和恢复命令。
2. 增加验证码发送失败、校验失败、登录失败、500 和数据库连接失败的监控指标。
3. 每 15 分钟清理过期验证码，清理失败只告警，不影响正常校验。
4. 记录 migration ID、部署包 SHA-256、环境配置状态和回滚版本。
5. 完成一次备份恢复演练，再开放真实用户注册。

**验收标准：**能够从备份恢复测试库；关键错误可告警；回滚步骤由另一人按文档执行成功。

### P2：认证稳定后开发业务闭环

认证稳定后再接入任务、认领配对、提交验收、评价、通知、反馈和自动退款。蛋蛋币余额与流水必须通过事务和幂等键维护，不能由前端直接修改。

## 4. 发布门槛

以下任一项未完成，都只能称为测试环境：

- CVM 验证码 500 已修复并完成全链路烟测
- 真实腾讯云 SMS 已配置并验证
- HTTPS、`COOKIE_SECURE=true`、正式 CORS 已生效
- 生产密钥未进入仓库和部署包
- 浏览器桌面/移动回归通过
- 备份恢复和回滚演练完成
- 明确确认仅使用 `dandan_world`，未读取或修改“航线” Supabase

## 5. 建议执行顺序与进度标记

- [x] 本地认证 API、验证码规则、前端 API 接入
- [x] CVM MariaDB、隔离数据库和 Prisma migration
- [x] P0 修复/澄清 CVM 验证码发送 500
- [x] P0 完成 CVM 全链路认证烟测（通过 `https://dsxnb.com/dd/api`，输出 `AUTH_SMOKE_OK`）
- [ ] P1 配置腾讯云 SMS 真实发送
- [x] P1 完成找回密码页面和 API 契约接入
- [x] P1 完成找回密码页面浏览器回归（本地桌面预览已验证入口、字段、倒计时按钮和提交按钮）
- [x] P1 完成 HTTPS、Secure Cookie、CORS、子目录 Nginx 代理和静态发布（进程守护仍待补齐）
- [ ] P2 完成备份、监控、恢复和回滚演练
- [ ] P2 认证发布签字后接入任务业务闭环

## 6. 数据隔离声明

本计划只针对蛋蛋校园。后端连接串指向南京 CVM 的 `dandan_world` MariaDB；不会读取、迁移、修改或复用“航线”项目的 Supabase URL、密钥、表或迁移文件。

## 7. dsxnb.com 子目录发布边界

蛋蛋校园发布地址为 `https://dsxnb.com/dd/`。`https://dsxnb.com/` 根路径和“航线”现有站点保持不变。

- 静态文件放在 `/var/www/dd/`。
- `/dd/api/` 反向代理到本机 `127.0.0.1:3310/api/`。
- `/dd/health` 反向代理到本机 `127.0.0.1:3310/health`，供监控和发布烟测使用。
- 生产环境前端 API 前缀为 `/dd`，本地预览仍使用 `http://127.0.0.1:3310`。
- Refresh Cookie Path 使用 `/dd/api/auth`，避免与“航线”站点的 Cookie 冲突。
- Nginx 配置模板见 `server/deploy/nginx-dsxnb-dd.conf`。

## 8. 盲盒交友接入边界

- 页面地址为 `https://dsxnb.com/dd/blind-box/`。
- 手机号登录继续复用蛋蛋校园认证；短信 provider 当前保持 Mock，后续配置腾讯云密钥即可切换。
- 盲盒模块使用 `buddy_preferences`、`buddy_boxes`、`buddy_messages`、`buddy_friend_requests`，不读取“航线” Supabase。
- 盲盒页面通过 `/dd/api/buddy-box/*` 访问后端，未登录请求统一返回 401。
