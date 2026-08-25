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

## 2026-08-25（九项迭代修复启动）

- 用户已完成 30 项确认：任务状态含待审核/已审核/已完成/待修改；移动端新增简洁侧边栏；敏感词前后端双重校验且不展示具体词语；“我的打听”使用八卦页小图标；蛋蛋币初始值 100；demo 流水保留；角色决定首页；好友申请 30 分钟拒绝冷却；仅已接受好友可聊天；复用 HTTP 轮询；允许必要最小迁移；多 Agent 分批累计至少 10 个分工。
- 根因审计完成：任务、反馈、打听/通知模型和接口缺失；盲盒好友/聊天权限与匹配不完整；主站首屏管理员静态闪现；固定 stage 造成手机/平板布局问题；敏感词过滤仍是盲盒局部前端函数。
- 下一阶段：先新增失败契约测试，再按 schema/routes、前端 API、任务/反馈/打听渲染、盲盒好友聊天、响应式/路由、敏感词、自检等文件边界分批实现。

## 2026-08-26（九项迭代本地完成）

- 业务迁移草案已创建：`server/prisma/migrations/202608260001_business_iteration/migration.sql`。
- Fastify 已新增任务、反馈、打听/回复、通知接口；任务发布默认为 `pending_review`，普通用户本人查询按 JWT 用户 ID 隔离，管理员审核由服务端角色校验。
- 统一 `server/src/content-filter.ts` 并接入新接口和盲盒消息/偏好边界，前后端提示均不展示具体敏感词。
- 盲盒推荐过滤 `stealth`，按 MBTI/兴趣重排；好友申请支持好友已存在、待处理、拒绝后 30 分钟冷却；聊天发送与历史读取要求 accepted 关系。
- PointAccount 新用户初始余额及注册流水改为 100 蛋蛋币，保留历史 demo 明细。
- 主站移除盲盒 NEW 角标，加入响应式断点、访客登录首屏、任务/反馈 API 插头和统一文本校验；API 客户端新增业务方法。
- 本地验证：`npm test` 12 个测试文件/47 个测试通过；`npm run build` 通过；前端三个脚本语法检查通过；Prisma schema validate 在完整占位 `DATABASE_URL` 下通过。
- 生产尚未执行本轮迁移、构建、PM2 重启或公网 smoke；下一步必须遵守备份→迁移→构建→日志→health 的单步流程。
- 前端任务二次审阅已完成：同步时清理静态演示发布卡片，仅渲染当前用户 API 任务；新增四状态筛选；审核按钮接入真实 review API。相关语法、构建和 47 项测试重新通过。
- 迁移审阅发现并修正字段宽度、复合索引、JSON NULLability 与 MySQL 默认值语法漂移；使用本地完整占位 `DATABASE_URL` 的 Prisma validate 已重新通过。

## 2026-08-26（最终本地收口）

- [x] 修复任务认领通知导致的隔离测试 500，生产通知逻辑保持不变。
- [x] 后端 53/53 测试、TypeScript 构建、Prisma generate/validate、前端/内联脚本语法和盲盒三端浏览器检查通过。
- [x] 重新生成前端 r8（18 文件）与后端 r7（47 文件）部署包，并完成 SHA-256 与禁入文件检查。
- [ ] CVM 生产发布仍待可验证 shell/MFA 会话：备份 -> 迁移 -> 构建 -> PM2 重启 -> 查看日志 -> `/health` -> 三端公网 smoke。

## 2026-08-26（本轮收口）

- 收口补丁继续：新增前端 `pointTransactions` 客户端方法，个人明细优先读取 MySQL 流水；打听“我的打听”改走 `/api/inquiries/mine`；新增服务端采纳事务路由，真实结算并通知回答者。
- 校验记录：误对 `.html` 文件执行 `node --check`，Node 报 `ERR_UNKNOWN_FILE_EXTENSION`；已确认是命令用法错误，后续改用项目测试与脚本抽取检查，不把该错误当作代码失败。
- 校验记录：PowerShell 传递带斜杠的 Node 正则字面量时出现 `Unterminated regexp literal`；改用字符串切分方式执行内联脚本语法校验。

- 清理盲盒运行时代码的 fallback adapter，收件箱与反馈列表改为服务端真实数据源；保留数据库历史 demo 记录。
- 为打听 tags 补充后端敏感词校验。
- 新鲜验证：前端三个脚本 `node --check` 通过；`npm test` 12 个文件、47 个测试通过；`npm run build` 通过。
- 浏览器 CLI 当前未返回快照或截图输出，桌面/手机/平板视觉验收未宣称完成。
- 线上部署仍未执行本轮迁移；必须先备份，再单步迁移、构建、检查 PM2 日志和 `/health`。
- 浏览器补充验收：连接现有 Chrome CDP 后，主站访客登录首屏和盲盒纯内容组件均可见；窄视口截图已生成，未发现独立导航壳。
- 三张源码内保留的开发测试发布卡已补 `DEMO` 标签；前端包已重打包并重新计算 SHA-256。
- 最终验证：12 个测试文件/47 个测试通过，TypeScript 构建通过，三个前端脚本语法检查通过，两个压缩包边界检查通过。
- 收口结果：`npm test` 12 个文件/47 个测试通过，`npm run build` 通过；前端三个 JS 与主站 3 段内联脚本通过语法检查。
- 浏览器烟测通过：访客主站显示登录首屏；盲盒内容组件标题和业务区域正常，无插件顶部导航/侧栏/页脚。
- 交付包 r2：前端 `A5F2A7082844ED9FA520442FF4EFE57D5D9B9EFE6BA7E43856F1EB32B9BC31AC`，后端 `87D6E4EDC6A7428648BA5A1AACB179489D30FB1994F4C4BF264DC5E402D58C47`。
- 生产仍未执行本轮迁移、备份、PM2 重启或线上 smoke；“上线”状态不变。

## 2026-08-26（任务结算与评价本地完成）

- 新增 `TaskClaim`、`Rating` Prisma 模型和 `202608260003_task_settlement` 迁移：任务类型、认领模式、奖励、人数上限、联系方式和要求均持久化。
- 新增任务认领、认领列表、确认配对、提交完成、发布者验收结算、取消退款和评价接口；复合唯一约束与服务端状态校验防止重复认领、重复评价和重复结算。
- 教学任务认领冻结蛋蛋币，求助/组队/奖励任务审核冻结发布者预算，完成和取消均通过幂等 `PointTransaction` 结算；前端真实任务卡不再直接修改余额。
- `submitPublish`、管理员发布、`doClaim`、`completeTask`、`confirmCancelTask`、`openClaimerManager`、`confirmAssign` 和 `submitRating` 已接入真实 API；无任务 ID 的三张开发卡继续保留本地 demo 行为。
- 新增管理员 `POST /api/admin/inquiries/refund-expired`：到期且无人回答的打听在事务中退款、标记 expired/refunded 并通知发布者，供受保护定时任务调用；前端不再伪造自动退款余额。
- TDD 契约测试覆盖幂等认领和重复评价；本地验证：12 个测试文件、49 个测试通过，TypeScript 构建通过，Prisma validate 通过，主站 3 段内联脚本和 API/盲盒脚本语法检查通过。
- 线上仍未执行本轮备份、迁移、构建、PM2 重启和三端 smoke；不得据此宣称本轮已上线。
- 最终交付包已重新生成并做边界检查：前端 `dandan-frontend-dd-20260826-business-iteration-r4.zip`（18 个文件，SHA-256 `16C5F92C24388BF6A077A08493DCD97A67918FFE8879334A1E5F84650BBAE784`）；后端 `dandan-server-deploy-20260826-business-iteration-r3.zip`（45 个文件，SHA-256 `B70DD8EFF8805DFA989FEAFA287B9DFFF4F096892F4239913A6B0416F32C4D5D`）。包内无 `.env`、本地密码、`node_modules` 或 `dist`。

## 2026-08-26（收口补丁与多端验收）

- 修复主站首屏管理员闪现：`#stage` 在会话恢复事件完成前保持隐藏，访客和登录用户均在正确状态渲染后显示。
- 补齐管理员反馈回复的前端敏感词前置校验；静态开发蛋蛋币/经验流水保留并渲染 `DEMO` 标签。
- 盲盒推荐关系状态接入服务端：已是好友、已有待处理请求、对方已拒绝和 30 分钟冷却均有明确 UI 状态；旧的反向拒绝记录在重新申请时复用，避免重复写入。
- 盲盒脚本按顺序 `defer`，对缺少可选消息入口的宿主做空节点保护；旧预览根目录导致的节点错误已通过当前包专用静态服务复核排除。
- 验证：`npm test` 12 个测试文件/49 个测试通过；`npm run build` 通过；Prisma validate 通过；三个前端脚本和主站内联脚本语法通过。
- 浏览器验证：当前包专用静态服务下盲盒无业务 JS 异常；390x844、768x1024、1440x900 均无横向溢出，截图保存于 `output/playwright/blind-box-mobile-r5.png`、`blind-box-tablet-r5.png`、`blind-box-desktop-r5.png`。
- 新交付包：前端 `output/releases/dandan-frontend-dd-20260826-business-iteration-r5.zip`，SHA-256 `914E08085616E8E603810A394A82776DC064D142E2CA61A74DA1D1832F7EC8F9`；后端 `output/releases/dandan-server-deploy-20260826-business-iteration-r4.zip`，SHA-256 `48DD1E9B8E5E40F8D47B93B0CD6C65985E750B15B750554A45C2668F6112006D`。
- 生产仍未宣称完成：必须先 CVM 备份，再迁移、构建、PM2 日志、`/health` 和线上三端 smoke；本轮未读取或记录任何密码、Token、验证码或 MFA。

## 2026-08-26（今日盲盒行动匹配补齐）

- 推荐接口新增可选 `action` 查询参数；服务端对推荐用户的 `todayActions` 做同值/包含关系匹配，命中时提升排序分，保留原有返回字段和 MBTI/兴趣排序。
- 盲盒揭示行动后，前端调用 `syncBuddyProfiles(selectedTodayAction)` 重新拉取推荐；API 适配器以 URL 编码参数传递行动，未传行动时保持原请求兼容。
- TDD 契约先红后绿：新增后端排序契约和前端连接点契约；专项测试通过。
- 生产仍未执行本轮迁移、构建、PM2 重启或线上 smoke；发布仍须按备份→迁移状态核对→构建→日志→health 顺序执行。
- 交付包已更新：前端 `output/releases/dandan-frontend-dd-20260826-business-iteration-r6.zip`（18 文件，SHA-256 `A10207C75EEC4CA06034424934869BA3DC701926B64D287B7CFED3E868A3D2D9`）；后端 `output/releases/dandan-server-deploy-20260826-business-iteration-r5.zip`（46 文件，SHA-256 `50508687A484861F24019A3937765F842C1A788DB8A3077296127D43302A43A8`）。

## 2026-08-26（HTTP 轮询与最终本地收口）

- 盲盒消息抽屉打开时每 15 秒同步收件箱；会话窗口打开时每 5 秒刷新聊天历史；关闭对应窗口时清理定时器。好友申请接受后立即刷新推荐关系状态。
- `server/npm test`：12 个测试文件、53 个测试全部通过；`npm run build` 通过；Prisma schema 在临时完整占位 `DATABASE_URL` 下通过。
- `api-client.js`、`blind-box/app.js`、`blind-box/buddy-box-api.js` 通过 `node --check`；主站 2 段内联脚本通过 `vm.Script` 抽取校验；`git diff --check` 无空白错误。
- 本地浏览器验证：盲盒直达内容页不含顶部导航、侧栏和页脚；390x844、768x1024、1440x900 均无横向溢出。截图位于 `output/playwright/blind-box-mobile.png`、`blind-box-tablet.png`、`blind-box-desktop.png`。
- 重新生成交付包：前端 `output/releases/dandan-frontend-dd-20260826-business-iteration-r7.zip`（18 文件，SHA-256 `87EAB959BC3A16BA6D7489C3D6157543F649C97A394EFF67BC0E98E10B70A829`）；后端 `output/releases/dandan-server-deploy-20260826-business-iteration-r6.zip`（46 文件，SHA-256 `FB5ECCE2B9C32A42D3F6E976976C3CAAB72600C17164DBC5671D3F8945DF2F82`）。
- 生产仍未执行本轮备份、迁移、PM2 重启和公网 smoke；未取得可验证 CVM 会话前不宣称上线。

## 2026-08-26（敏感词与盲盒接口收口）

- `assertSafeJsonText()` 已覆盖盲盒高级玩法的嵌套 JSON；前端绕过后直调接口仍会返回统一安全提示，且不暴露命中词。
- 注册、资料更新、反馈的全部用户可写文本字段均接入服务端统一敏感词校验，形成前端提示与后端拦截的双重校验。
- 盲盒 API 地址在本地静态预览时使用 `http://127.0.0.1:3310`，生产仍使用 `/dd`，并保留 `window.DANDAN_API_ORIGIN` 覆盖插头。
- 高级玩法删除无服务端记录时的静态伪造结果；兴趣雷达无统计时明确显示“暂无服务端统计”。
- 本地验证：12 个测试文件、55 个测试全部通过；TypeScript 构建、Prisma generate/validate、三个前端脚本语法与 `git diff --check` 全部通过。
- 浏览器结构验收：主站点击侧栏“盲盒交友”后在右侧激活内容组件；盲盒直达页不含 header/nav/footer，390x844、768x1024、1440x900 均无横向溢出且无 `New` 文案。静态服务未启动 3310 后端时会产生预期的连接拒绝，不能替代线上健康检查。
- 生产发布仍待可验证 CVM/MFA 会话，必须按备份 -> Prisma 迁移 -> 构建 -> PM2 日志 -> `/health` -> 公网 smoke 单步执行。
- 新交付包：前端 `output/releases/dandan-frontend-dd-20260826-business-iteration-r9.zip`（18 文件，SHA-256 `0FFF0CE68A49C5E024D82C8417B0F978A708478DD98BDB60501D434D1E699F0A`）；后端 `output/releases/dandan-server-deploy-20260826-business-iteration-r8.zip`（46 文件，SHA-256 `63A15736E15DDE1AECA51BFB1DC988D56546C885634C4EFB45F69A2B39226FDB`）。两包均无环境文件、本地密码、`node_modules` 或 `dist`。

## 2026-08-26（盲盒真实结果与关系并发收口）

- 移除兴趣雷达和 AI 破冰助手在无服务端结果时的固定文案，分别显示“暂无服务端统计”和“暂无服务端破冰话题”。
- 好友申请在事务中锁定双方用户记录，结合既有唯一约束处理并发双向申请；现有好友、待处理和拒绝冷却规则不变。
- 本地验证重新通过：TypeScript 构建、Prisma generate/validate、12 个测试文件共 55 项测试、三个前端脚本语法和差异检查。
- 浏览器结构验证：盲盒直达组件在 390x844、768x1024、1440x900 无横向溢出，且无 header/nav/footer；主站仍包含同源 `#page-buddybox` iframe 容器。
- 待完成：重新生成 r10/r9 交付包并做文件边界与 SHA-256 校验；生产仍须按备份、迁移、构建、PM2 日志、health、公网 smoke 单步执行。
- 已生成交付包：前端 r10（18 文件，SHA-256 `D33240081899937EC2544A746408990CE743B2C8FD60E7CF7F0B1CD6E55EA584`）；后端 r9（46 文件，SHA-256 `19A5BFA7F9E6BDF2504A23DE22F8CC468AC229FA041AE23E8E4C9464FA57EABF`）；两包禁入项均为 0。

## 2026-08-26（我的打听汇总与真实任务发布收口）

- `/api/inquiries/mine` 现在按当前用户读取本人打听，并返回 `replyCount` 与最多 20 条他人 `recentReplies`；未新增表、未改变既有基础字段。
- 打听页“我的打听”面板直接渲染该专属汇总的最新回复摘要，不再把全站帖子逐一当作本人消息数据源。
- 普通用户发布任务时，空标题或空描述会直接提示，不再自动替换为开发阶段示例文案后写入 MySQL。
- 新增后端和前端回归契约；全量验证为 12 个测试文件、58 项测试通过，TypeScript 构建通过。
- 待完成：更新交付包到前端 r11、后端 r10，生产仍需按备份、迁移状态确认、构建、PM2 日志、health、公网 smoke 单步发布。
- 已生成交付包：前端 r11（18 文件，SHA-256 `FD51BB38499DF6531E93F9A46FA92AD9F80CBF1376E564B3165E4A5DA4700968`）；后端 r10（46 文件，SHA-256 `61916188C3E1FA9CD844F9F5A5D3AC6B54AA9099488F62F333404B6B284639AD`）；禁入项均为 0。
- 公网只读检查：`https://dsxnb.com/dd/health` 返回 200；但线上首页尚未出现 `myInquiriesPanel`/`recentReplies`，且仍有旧发布示例兜底，确认 r11/r10 尚未部署。当前机器没有 SSH 配置或私钥，无法执行 CVM 写操作。

## 2026-08-26（TDD 与响应式收口）

- [x] 保留 DEMO 蛋蛋币流水并与真实 MySQL 流水合并展示，禁止 DEMO 写回数据库。
- [x] 校验打听评论 `parentId` 的同打听归属和回答类型，跨打听关系返回 400。
- [x] 补齐打听通知的回复者/标题上下文，通知可打开对应打听；删除错误本地假通知。
- [x] 对打听墙用户输入做 HTML 与内联参数转义。
- [x] 修复手机/平板任务双栏、广场卡片、任务条、固定右栏、任务 Tab、个人卡和弹窗的横向溢出规则。
- [x] `npm test` 12 个测试文件、67 项通过；`npm run build`、主站内联脚本语法、`git diff --check` 通过。
- [x] 已生成前端 r13（19 文件，SHA-256 `BF926AA8BB893C0045169E0A8546FC85CD7C5FC2F0B56EF94E535BA3EA7CF309`）和后端 r12（47 文件，SHA-256 `4D91F1A797BA9E7E8C5CF59B2C113E619E911DC5A7B5BCBEC70DE8D9867BCB51`）发布包；敏感词过滤脚本已入前端包，禁入文件为 0。
- [ ] CVM MFA 会话恢复后，按备份 -> 迁移 -> 构建 -> PM2 日志 -> `/health` -> 三端公网 smoke 发布。

## 2026-08-26 本轮迭代

- [x] 盲盒前端完整敏感词预检、收件箱 XSS 转义、好友拒绝 UI、空推荐清理。
- [x] 好友关系更新时间 tie-break、聊天历史最近 100 条。
- [x] 新增学生侧边栏“我的打听”独立页面，继续复用 `/api/inquiries/mine` 私有查询。
- [x] DEMO 发布任务标记并在真实任务同步时保留，不混入真实任务过滤结果。
- [x] `npm test` 72/72、`npm run build`、脚本语法和 `git diff --check` 通过。
- [x] 交付包 r14/r13 已重新生成并校验 SHA-256，排除 `.env`、密码文件、`node_modules`、`dist`。
- [ ] 生产部署仍等待腾讯云 CVM MFA；本轮没有远端数据库、文件或 PM2 写操作。
