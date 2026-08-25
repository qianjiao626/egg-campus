# 进度记录

## 2026-08-23

- 已阅读 `backend-handoff.md` 与 `growth-school-task-flows.md`。
- 已确认当前项目为纯前端 Demo，无持久化和后端 API。
- 已整理数据库建设的分阶段任务，优先覆盖用户数据和安全基础，再接任务闭环。
- 已创建 `server/` 后端工程，采用 Node.js + TypeScript + Fastify + Prisma + MySQL。
- 已创建一期 Prisma schema 和初始迁移：用户、会话、用户统计、角色、蛋蛋币账户、蛋蛋币流水、审计日志。
- 已实现注册、登录、退出、个人资料、角色、蛋蛋币账户和流水 API。
- 已实现密码哈希、JWT 会话、输入校验和公开资料脱敏。
- 验证结果：4 个测试通过，TypeScript 构建通过，Prisma schema 格式和校验通过。
- 已通过真实进程启动检查：服务监听 `3310`，`GET /health` 返回 `{"status":"ok"}`。
- 已确认可使用现有南京 CVM 自托管 MySQL，不需要新购 TencentDB；真实迁移和数据库验收等待 CVM 上的 MySQL 连接信息。
- 已通过腾讯云控制台确认 CVM：南京三区，实例 `ins-6xonyz5y`，内网地址 `10.206.0.10`，公网地址 `119.45.253.94`，运行中。
- 已将 `.env.example`、README 和数据库进度清单切换为 CVM 本机 MySQL 方案。
- 已新增 `server/cvm-mysql-setup.md`，包含 MySQL 检查、数据库/应用账号创建、迁移和启动步骤。
- OrcaTerm 已接入 CVM 登录终端，可继续执行服务器命令。
- `npm audit --omit=dev --audit-level=critical` 未发现严重生产依赖漏洞；仍有 4 个高危项来自 Prisma CLI 开发依赖，需在后续依赖升级时处理。
- 已在南京 CVM 安装并启用 MariaDB 10.3（MySQL 兼容），服务监听已限制为 `127.0.0.1:3306`。
- 已创建 `dandan_world` 数据库及仅限 `127.0.0.1` 的 `app_user`，已完成应用账号 TCP 连接和权限验证。
- 应用数据库密码已生成并保存在本机未跟踪文件 `server/.cvm-app-password.local`，未写入聊天或源码包。
- 后端源码上传到 CVM 尚未完成；下一步为通过 OrcaTerm 文件管理器上传压缩包后执行 Prisma migration。
- 已确认与“航线”项目隔离：本服务无 Supabase 依赖，只使用独立的 `dandan_world` MariaDB 数据库和本目录 `.env`。
- 已确认当前认证状态：后端已有注册、登录、退出 API；前端仍为 Demo 登录/注册逻辑，验证码、密码找回和真实 API 接入尚未完成。
- 已制定认证与验证码实施计划：`docs/superpowers/plans/2026-08-23-auth-and-verification.md`。
- 已补齐验证码目标格式校验、密码找回请求接口和腾讯云 SMS 配置驱动 provider；未配置腾讯云密钥时不会假装发送成功。
- 已将 `backend-handoff-package/growth-school.html` 的登录/注册表单接入独立 `api-client.js`：账号密码登录、手机号/邮箱验证码、验证码倒计时、密码确认、退出时撤销服务端会话。
- 已移除新流程对 `REGISTERED_USERS` Demo 用户表的依赖；页面不使用 Supabase client。
- 本地验证：`npm test` 12/12 通过，`npm run build` 通过，`DATABASE_URL` 临时设置后 `npx prisma validate` 通过，`api-client.js` Node 语法检查通过。
- 尚未完成：真实腾讯云 SMS 密钥配置、CVM 上传/迁移/进程部署、真实短信端到端验证和浏览器自动化回归；这些需要生产凭据与服务器操作权限。
- 当前认证评估已更新：本地注册、登录、验证码、找回密码和会话代码已搭建；CVM 验证码发送烟测仍返回 500，因此尚未达到生产发布条件。
- 已新增当前版后续计划：`docs/auth-next-steps-plan.md`，按 P0/P1/P2 列出修复、联调、短信、前端、HTTPS、安全、备份和业务闭环路线。
- P0 调查结果：CVM 日志中的 500 为手工终端请求产生的 `FST_ERR_CTP_INVALID_JSON_BODY`，不是 Prisma 或验证码表故障；使用正确 JSON 后验证码接口返回 202。
- 已修正 `server/cvm-auth-smoke.sh`：受保护的 `/api/users/me` 和退出请求现在带 refresh 后取得的 access token；CVM 核心注册、刷新、资料、退出烟测通过并输出 `AUTH_SMOKE_OK`。
- 已为 smoke 脚本加入找回密码、重置后旧会话失效和新密码登录检查；尚未在 CVM 重新执行该扩展流程。
- 已补充前端找回密码弹窗、验证码倒计时和重置 API client；新增 `frontend-auth-contract.test.ts`。本地验证：6 个测试文件、18 个测试通过，构建和 `api-client.js` 语法检查通过。
- 找回密码 CVM 烟测进一步定位：申请验证码返回 202、验证码校验返回 200，但确认返回 400；根因是 `passwordResetConfirmSchema` 复用了要求客户端提交 `purpose` 的通用 schema，而前端/脚本按安全设计未提交该字段。
- 已按 TDD 修复 `passwordResetConfirmSchema`：服务端固定用途为 `reset_password`，客户端不再需要传 purpose；新增验证测试后，本地总计 19 个测试通过、构建通过。CVM 源码同步/重启后的最终重测尚未确认。
- 本地浏览器回归已完成：登录弹窗可见“忘记密码”，点击后找回密码弹窗显示邮箱/手机号、6 位验证码、获取验证码、新密码、确认密码和重置按钮；预览地址为 `http://127.0.0.1:4173/growth-school.html`。
- CVM 最终复测当前受 OrcaTerm 会话状态影响：旧会话被历史长命令占用，新标签需要腾讯云 MFA；未在未确认 MFA 的情况下重启线上服务。下一次操作需先完成 MFA 或恢复旧终端，再同步干净构建并重跑 reset smoke。

## 2026-08-24

- 已将 `盲盒交友模块` 接入蛋蛋校园，页面入口为 `https://dsxnb.com/dd/blind-box/`，使用现有认证会话和独立 `buddy_*` 数据表。
- 已完成 CVM Prisma 迁移、静态文件部署、Nginx `/dd` 子路径代理和 PM2 进程接管；修复了 PM2 未加载 `.env` 导致的启动失败。
- 线上验证：根站、蛋蛋校园和盲盒页面均返回 200；`/dd/health` 返回 200；未登录盲盒推荐 API 返回 401；根站“航线”页面标题和配置保持不变。
- 短信真实 provider 仍按要求暂缓，当前验证码 provider 为 Mock；手机号登录和用户自行设置密码保留。
- 已加入 `server/deploy/backup-dandan-world.sh`、`server/deploy/verify-backup.sh` 及 `docs/production-operations.md`，用于备份、恢复验证、监控和回滚；CVM 实际备份尚因 OrcaTerm MFA 会话中断待执行。
- 本地最终验证：后端 7 个测试文件、21 个测试通过；TypeScript 构建通过；盲盒前端脚本语法检查通过。

## 2026-08-24（认证与盲盒持久化继续）

## 2026-08-24（盲盒内容组件最终收口）

- 盲盒入口确认只保留内容组件：`blind-box/index.html` 无插件顶部导航、自有侧栏、页脚、标题壳或 embed 条件分支。
- 主站入口使用相对 `blind-box/` 组件路径，兼容 `/dd/growth-school.html` 线上子路径和本地静态预览；主站 iframe 继续关闭内部滚动并由主站容器控制高度。
- 盲盒核心业务 DOM、`app.js`、`buddy-box-api.js` 和数据库接口插头均保留。
- 新增盲盒纯内容契约测试；本地最终结果：9 个测试文件、34 个测试通过，TypeScript 构建通过。
- 已生成前端交付包和精简后端部署包；尚未执行本轮 CVM 上传/线上重启。
- 新增本地 `auth-session-flow.test.ts`，用真实 Fastify 路由覆盖注册 -> refresh -> `/users/me` -> logout -> 旧 refresh 失效；最终本地验证为 10 个测试文件、35 个测试通过，构建和三个盲盒脚本语法检查通过。
- 本轮公开线上检查：`/dd/health` 200、`/dd/blind-box/` 200、未登录盲盒推荐 401；CVM 最新迁移/PM2 版本和登录态跨刷新仍待服务器凭据验收。
- 线上公开 `growth-school.html` 当前仍是旧版绝对 iframe 路径；不影响现有盲盒页面加载，但最新工作区前端包尚未发布到线上静态目录。
- 发现并修复会话共享风险：旧文档/配置使用 `/dd/api/auth` Cookie Path，会阻止盲盒 API 携带 refresh Cookie；现统一为上游 `/api`、Nginx 公开 `/dd/api`，本地测试总计 10 个文件、36 个测试通过。

- 用户追加目标：确认注册真实可用；管理员和普通用户会话可跨刷新/重新打开页面恢复；盲盒所有设计接口按当前用户落库；与航线 Supabase 隔离；使用 Ponytail 简化实现；并行智能体协作；关键记录同步到 Obsidian 兼容 Markdown。
- 当前认证审计确认：后端注册、登录、刷新、退出、验证码、找回密码 API 已存在；前端 `api-client.js` 使用 HttpOnly refresh cookie + 内存 access token，不把密码或 refresh token 写入 Web Storage；主站监听 `dandan:session-restored` 恢复普通用户/管理员导航状态。
- 盲盒审计确认：偏好、推荐、消息、好友申请已真实数据库化；高级玩法 adapter 仍有大量预览 fallback，`publishBoard` 仍拒绝写入。
- TDD 已新增高级玩法持久化契约测试；当前在实现前按预期失败（新路由尚不存在，返回 404）。
- 已新增 Prisma `BuddyFeatureRecord` 模型及迁移草稿 `20260824094000_buddy_feature_records`，下一步生成客户端并接入服务端路由/前端 adapter。
- 已启用 Ponytail full：优先复用现有认证、PointAccount、BuddyBox 和 Fastify/Prisma，不引入新依赖；高级玩法采用一张用户归属 JSON 记录表承载可扩展 payload，保留后续拆表空间。
- 已启动并行审计：认证持久化、盲盒前端 adapter、Obsidian 兼容文档同步；所有子智能体改动需在主线程复核后才可合并。

## 2026-08-24（线上版本核对）

- 已通过 OrcaTerm 恢复 CVM 会话并完成只读核对：PM2 `dandan-world` 在线，公开 `/dd/health` 返回 200。
- 当前线上目录仍为旧版 `/root/dandan-world-server-20260824004500`，静态文件哈希与最新认证持久化部署包不一致；未执行上传、迁移或重启。
- 本地最新交付包为 `output/releases/dandan-frontend-dd-20260824-auth-persistence-final-v3.zip` 与 `output/releases/dandan-server-deploy-20260824-auth-persistence-final-v3.zip`。
- 补齐盲盒刷新恢复：新增 `GET /api/buddy-box/features`，页面启动时恢复当前用户留言和已完成玩法状态；最新包升级为 `...auth-persistence-final-v4.zip`。
- 增加管理员 refresh 角色回归测试；最新本地结果为 10 个测试文件、42 个测试通过，交付包升级为 `...auth-persistence-final-v5.zip`。

## 2026-08-24（授权发布核对）

- 用户已授权发布操作。
- 线上公开 smoke 仍为 `/dd/health` 200、`/dd/` 200、`/dd/blind-box/` 200、匿名盲盒推荐 401。
- 通过 OrcaTerm 尝试传输 v5 包和切换，但线上静态脚本哈希仍未变更，远端落盘证据不足；状态保持“代码完成，线上待验收”，不宣称已发布。

## 2026-08-25（发布继续）

- 后端 v5 包远端 SHA-256 已一致。
- 前端 v5 大包传输过程中触发腾讯云 MFA，当前远端会话为 0；前端未发布，旧线上版本保持运行。
- 待完成：用户在腾讯云窗口完成 MFA 后，继续前端传输校验、迁移、PM2 切换和线上认证/盲盒 smoke。

## 2026-08-25（v5 线上发布完成）

- 用户完成 MFA；前后端 v5 包均完成远端 SHA-256 校验。
- 新后端目录迁移、构建、PM2 切换和 `pm2 save` 完成；旧后端目录与 `/var/www/dd.backup-auth-persistence-v5` 保留。
- 线上 `health`、主站、盲盒页和匿名 401 smoke 通过；注册→refresh→`/users/me`→盲盒 features→退出生产 smoke 通过。
- 根站“航线”保持 200 和原标题；当前目标已达到上线验收条件，剩余为 SMS 真机、备份恢复和高级玩法结算语义等后续工作。
