# 数据库建设发现

## 2026-08-28 真人式回归与版本边界发现

- 全站真人式浏览器走查覆盖注册、会话恢复/退出、身份资料、任务、排行榜、通知、打听、盲盒、好友、反馈和移动端；本轮没有白屏、控制台 error-level 消息或身份回退到静态“隐士蛋 · 蛋总”。
- 隔离真实写入回归为 `25/25`，仅写入 `dandan_campus_test`，清理结果为 `3 users`、`7 point transactions`、`0 attachments`；生产只做 health 与页面 HTTP 只读检查。
- 主页面结构静态检查结果为 `<div>` `1362/1362`、`#stage` ID `1` 个、初始化查询 `2` 个；此前失败的是 PowerShell/Node 多层引号命令，不是页面结构失败。
- 原发布脚本只复制两个前端文件，而清单声明的身份、实时、盲盒和角色资源未被覆盖，可能造成线上新旧代码混用；r2 已改为组件级 manifest + 完整运行时 staging。
- `verify-release-boundary.mjs` 现会拒绝 superseded、isolated-only 和非活动版本的生产部署，并检查本地 HTML/JS/CSS 依赖是否都在清单中；部署脚本强制 `RELEASE_MANIFEST`，支持备份、原子替换和失败恢复。
- 版本边界回归已覆盖 staging、已批准部署、备份 `.latest` 指针和中途失败恢复；r2 当前仍 `productionDeployable: false`，所以不能据此执行生产上传或 Nginx reload。

## 2026-08-27 完成度审计发现

- `docs/superpowers/plans/2026-08-27-production-data-realtime.md` 中任务 4-10 的勾选状态落后于代码；本地 207 项测试已经覆盖相应模块，但勾选不能在缺少隔离环境证据时直接全部标记完成。
- 独立任务“蛋蛋校园线上轮询测试”真实存在，但其唯一执行轮次明确记录测试库尚未建立；后续 10 分钟报告由只读 GET 脚本生成，只证明线上无 5xx，不证明注册、任务、盲盒、树洞、邀请码、持久化或 WebSocket 业务闭环。
- 生产部署和白名单数据清理已完成；下一阶段所有写入测试必须只使用 `dandan_campus_test`，测试服务应仅监听回环地址，避免新增公网测试入口。
- 生产数据库当前只有三个指定账号和三条初始蛋蛋币流水，因此不得用生产注册账号完成 E2E。
- 前端仍初始化 `userSkills = ['Python','PPT制作','高数','简历优化']`；这是一组未由接口返回的业务资料，契约测试尚未覆盖，必须改为空数组并由资料接口回填。
- `growth-school.html` 仍存在按用户名包含“蛋总”生成固定属性/MBTI 的旧资料逻辑，需要确认调用链；若可达则属于伪造用户资料，必须删除或改为只使用 `/public-profile` 返回值。
- 调用链已确认：`showCharDetail()` 由管理员任务卡和发布者蛋形象点击触发，固定生成“隐士/超然物外”和满属性，属于可达的伪造资料；应只保留角色外观与任务上下文，删除固定 MBTI/属性展示。
- `showUserEggModal(name)` 对非当前用户依赖 `publicProfiles` 缓存；排行榜详情会先按用户 ID 调真实 `/public-profile`，但任务和打听只传昵称，缓存缺失时资料不可用。这是动态资料入口的后续缺口，需结合 E2E 结果决定是否让任务/打听响应携带用户 ID 并统一按 ID 加载。

## 2026-08-27 审计过程中错误

- `read_thread` 首次使用 `turnLimit=20` 超过工具上限 10；改为 10 后读取成功。
- 误尝试通过 `functions.exec` 嵌套调用 `read_thread`，工具不存在；改用 Codex App 的直接线程读取工具。

## 2026-08-26 收口发现

- 盲盒 `app.js` 残留注释形式的 fallback adapter 会误导维护者；已删除，仅保留真实宿主插头。
- `inbox` 与 `FEEDBACK_TICKETS` 的静态初始对象会造成接口失败时显示假消息，已清空；服务端返回仍使用原渲染函数。
- 打听 `tags` 是用户可提交文本，创建接口已纳入统一 `assertSafeText`。
- 浏览器自动化命令退出码为 0 但无 snapshot/screenshot 输出，属于工具会话未建立，不属于页面通过证据。

## 2026-08-26 任务结算复核

- 任务审核原先只改状态，新增字段后必须把任务类型、奖励和人数上限一起写入，否则认领接口无法判断预算与名额。
- `TaskClaim` 和 `Rating` 采用复合唯一约束，服务端仍需先做业务状态查询；唯一约束作为并发请求的最后一道幂等保护。
- 真实任务卡必须以 `data-task-id` 为切换条件：带 ID 的卡只读服务端余额/状态，没 ID 的保留卡才允许演示逻辑，避免线上用户余额被 DOM 操作覆盖。
- 完成结算和到期退款必须使用稳定幂等键写入 `PointTransaction`；页面刷新不能成为退款或奖励的触发条件。
- 本轮新增迁移涉及 `ALTER TABLE tasks`、两个新表和多条外键/索引，线上执行前必须备份并逐步读取 Prisma migrate 输出，留意 MySQL DDL 隐式提交。

## 2026-08-26 收口补丁复核

- 主站 `#stage` 初始设置为不可见，等 `dandan:session-restored` 完成角色渲染后再显示，避免管理员壳首屏闪现。
- 管理员反馈回复在发送请求前调用统一前端敏感词校验；服务端仍保留 `assertSafeText` 作为第二层校验。
- 个人蛋蛋币与经验开发记录继续保留，并在渲染时显示 `DEMO`；真实 MySQL 流水不标记为 demo。
- 盲盒推荐接口批量读取当前用户与推荐用户的关系状态，前端显示“已是好友”“已有待处理请求”“对方已拒绝”，拒绝冷却期内禁用再次申请。
- 重新申请已拒绝关系时复用原关系记录并改变方向，避免因历史反向记录造成重复关系行。
- 盲盒静态脚本改为按顺序 `defer`，并对可选消息入口和计数节点做空节点保护；适配主站嵌入与独立内容组件加载时序。
- 本地静态服务旧预览曾加载旧版脚本并产生节点为空错误；切换到明确指向 `backend-handoff-package` 的临时服务后，浏览器仅剩无后端代理时的 404，无业务 JavaScript 异常。
- 390x844、768x1024、1440x900 三个视口均无横向溢出；截图保存于 `output/playwright/blind-box-mobile-r5.png`、`blind-box-tablet-r5.png`、`blind-box-desktop-r5.png`。

## 2026-08-26 今日盲盒行动匹配复核

- 原推荐分只使用 MBTI 和兴趣重合，盲盒抽出的今日行动没有进入排序，导致用户刚抽出的行动不会影响推荐顺序。
- 修复采用可选查询参数 `action`，以同值或互相包含匹配 `BuddyPreference.todayActions`；命中增加排序分，不改变用户隐身过滤、关系状态或响应字段。
- 前端抽盒揭示后重新请求推荐，未抽盒时仍使用无参数请求，保持已有页面加载行为。
- 测试先验证旧实现将不匹配用户排在前面，再实现修复并转绿；未新增数据库表或迁移。
- 交付包已重打包为前端 r6、后端 r5；文件边界检查再次确认不含环境文件、本地密码、依赖目录或 `dist`。

## 2026-08-26 HTTP 轮询与收口复核

- 消息抽屉和会话窗口的轮询必须绑定打开/关闭生命周期，分别使用 15 秒和 5 秒间隔，并在关闭时清理，避免隐藏页面继续请求。
- 根目录没有 `package.json`，测试入口在 `server/`；Prisma validate 需要完整 `DATABASE_URL`，本地校验使用仅限当前进程的占位 URL，未写入文件。
- PowerShell 下不要把 `Copy-Item -File` 当作可用参数，也不要把 HTML 直接交给 `node --check`；应使用显式包清单和 `vm.Script` 抽取内联脚本。
- 静态前端服务未代理后端时会产生 API 404，这不能替代后端 smoke；本轮只据此确认页面结构、组件外壳和视口溢出，线上验收仍需 CVM。
- r7/r6 压缩包边界检查通过：前端 18 文件、后端 46 文件，均不含 `.env`、本地密码、`node_modules` 或 `dist`。

## 2026-08-26 收口发现

- 任务认领接口的通知写入属于生产关键副作用，但契约测试必须隔离真实 Prisma；未 mock 时会在测试启动环境没有 `DATABASE_URL` 的情况下返回 500，已补充针对性 mock。
- 本地前端静态服务下的 API 404 只代表没有启动本地后端代理，不作为业务失败证据；真正生产可用性仍以 CVM 日志、`/health` 和受保护 API smoke 为准。
- 最新部署包边界：前端 18 文件、后端 47 文件；不含 `.env`、`.cvm-app-password.local`、`node_modules`、`dist`。

## 2026-08-26 敏感词与组件验收发现

- 单层字符串过滤不足以保护盲盒高级玩法：接口 payload 中的数组/对象字段可被直接调用者构造，必须递归检查整个 JSON 树。
- 安全拦截响应必须统一为“内容包含敏感词，请修改后再提交”，不能把命中词返回给前端或写入用户可见日志。
- 静态预览下主站请求本地 3310 是符合开发拓扑的；没有启动后端出现 `ERR_CONNECTION_REFUSED` 只表明依赖服务未运行，不能据此判定浏览器业务失败。
- 内容组件的验收要分别验证直达页和主站嵌入页：直达页不得出现插件外壳，主站页必须保留主站侧栏并能激活右侧 iframe。

## 已确认

- 当前项目是单文件前端 Demo，内存变量刷新即丢失，无 fetch/Ajax/API。
- 交接文档已经给出 users、user_stats、tasks、task_claims、ratings、point_logs、gossip、notifications、feedback_tickets、user_characters 等表的初稿。
- 当前三类任务的状态和交互并不完全统一，组队型任务缺少完整的经验值和互评闭环。

## 建模调整建议

- users 负责身份和公开资料；密码只保存 password_hash，不保存明文密码。
- 蛋蛋币不应只依赖 users.points：至少增加 available_balance、frozen_balance 或独立 point_accounts 表，并用 point_transactions 记录每次变动。
- 任务状态、认领状态和结算状态应分开建模，避免用一个字段表达多个角色的状态。
- 联系方式不能随公开任务详情返回，只有配对双方在授权状态下读取。
- 评价必须使用数据库唯一约束和服务端权限校验防重复。
- 自动退款必须由后端定时任务执行，不能依赖页面打开或刷新。

## 风险

- 直接套用交接文档中的 ENUM 会让后续状态扩展变更困难；建议用 VARCHAR + CHECK 或状态字典表，并由后端状态机约束。
- 仅在腾讯云控制台开放公网白名单会扩大攻击面；优先 VPC 内网，开发时使用受限固定 IP 或 SSH 隧道。
- 生产库、测试库和本地开发库必须隔离，禁止共用账号和连接串。

## 2026-08-25 迭代修复根因审计

- `backend-handoff-package/growth-school.html` 的我的任务、反馈、八卦/打听均为本地数组或 DOM 状态，没有真实 API 调用；默认首屏静态激活管理员工作台，异步会话恢复后才纠正角色，造成管理员闪现。
- `backend-handoff-package/api-client.js` 目前只有认证、用户资料、统计、角色和积分账户客户端方法；没有任务、反馈、打听、回复、通知或聊天历史方法。
- `server/src/app.ts` 目前只有认证、用户、盲盒基础接口；Prisma schema 只有 User/Auth/Point/Buddy 等模型，没有 Task、Feedback、Inquiry、Reply、Notification。
- 盲盒已有 `BuddyMessage` 与 `BuddyFriendRequest`，但推荐未使用 `BuddyPreference` 相似度、消息未限制已接受好友、好友 upsert 会重置拒绝关系，且没有会话历史接口。
- `PointAccount` 和注册流水默认仍为 10；本次需求要求新用户为 100，首条来源文案为“登录获赠蛋蛋币 +100”，带 demo 标记的历史开发记录保留。
- 敏感词函数目前位于盲盒前端 `app.js`，命中时展示具体词语；需要抽成可复用模块，前后端都调用，并统一只提示“内容包含敏感词，请修改后再提交”。
- 主站唯一明确的盲盒 `NEW` 角标在 `growth-school.html` 学生侧边栏；移动端根因是固定 1440x1024 stage 和全局 transform 缩放。

## 2026-08-26 盲盒数据真实性与并发控制

- UI 中的“暂无服务端统计”和“暂无服务端破冰话题”是明确空状态，不得用固定活动、话题或安全状态伪造服务端玩法结果。
- 好友申请的方向反转并发会绕过单方向预查询；事务中锁定双方用户行，再用业务状态和唯一约束双层保护，避免重复关系记录。
- Prisma schema 校验依赖 `DATABASE_URL`；本地只在当前进程注入完整占位连接串，不写入 `.env`，不记录真实密码。
- 静态前端预览会因未启动 3310 API 出现连接错误；本轮浏览器证据只覆盖页面结构、组件外壳和响应式，不等同于生产 API 可用性。

## 2026-08-26 我的打听数据源与发布表单

- “我的打听”不能只按全站列表在前端筛选：除了权限边界不直观，还会为每条帖子追加回复请求。专属 MySQL 查询应以当前用户为条件，直接携带回复数量和最近回复摘要。
- 新增只读字段必须保留原响应字段，客户端以可选字段方式消费，确保旧客户端仍能正常读取本人打听列表。
- 真实发布接口前不能用演示标题或描述替代空输入，否则会把开发内容永久写入生产数据库；应在调用 API 前阻止提交并给出明确提示。
- 公网 `/dd/health` 的 200 仅证明旧线上服务存活，不证明本地交付版本已发布。源码特征检查显示线上缺少本轮“我的打听”汇总字段且保留旧发布兜底，因此发布状态必须保持待执行。
- 当前工作机不存在 `~/.ssh/config` 和 SSH 私钥；没有可验证 CVM shell 时不得上传文件、迁移数据库或重启 PM2。
## Blind-box chat/friend audit (2026-08-26)

Read-only findings for `/root`:

- **P1 relationship status selection:** `server/src/app.ts:873-904` ranks relationship rows by status only. When rows have equal status (especially rejected records in both directions), it keeps whichever `findMany` returns first and does not compare `updatedAt`. A recent rejection can therefore be hidden by an older rejection and incorrectly allow a new request inside the 30-minute cooldown. Select accepted/pending first, then the newest rejected row.
- **P1 conversation history window:** `server/src/app.ts:963-969` orders messages ascending and applies `take: 100`, returning the oldest 100 messages. Long conversations omit recent messages. Query newest 100 descending and reverse before serializing, or paginate.
- **P2 inbox XSS:** `backend-handoff-package/blind-box/app.js:202-210` inserts `item.name` and `item.text` directly into `innerHTML`; both come from user-controlled nickname/message data. Escape these values before interpolation while preserving the unread marker.
- **P2 friend-request reply action:** `renderInbox()` always renders `回复留言`, including pending friend requests. Clicking it calls `sendMessage`, which the server correctly rejects until friendship is accepted. Hide/disable reply on `type === 'friend'`; expose conversation only after acceptance.
- **P2 stale recommendations:** `syncBuddyProfiles()` at `app.js:189-200` returns when the server returns an empty profiles array, leaving old cards rendered. Clear `profiles` and call `renderProfiles()` on an empty successful response.
- Existing server message POST/GET enforce accepted friendship and content filtering; accept/reject routes enforce recipient ownership. There are no focused tests covering latest-history selection, rejected cooldown selection, inbox XSS rendering, or accepted-only UI actions.

## 2026-08-27 隔离 E2E 与增量部署结论

- 测试服务使用独立库 `dandan_campus_test` 和回环端口 `3311`；本地仅通过 SSH 隧道 `127.0.0.1:13311` 访问，未向生产写入测试账号。
- 真实写入 E2E 两次执行均为 22/22，通过注册、refresh + `/me`、资料二次编辑、邀请奖励、任务审核/公开/接取/放弃、打听、盲盒、好友聊天、排行榜、公共/管理员/私有 WebSocket 和断线 REST 兜底。
- 测试报告生成器必须对 `password`、`token`、`cookie` 字段统一脱敏；最终报告已确认不含临时密码和 JWT。
- 本机与远端 `dist` 逐文件 SHA-256 比较后，只有测试构建文件存在差异，生产后端业务构建无需覆盖或重启。
- 本机无 `rsync` 时，用哈希清单加只含差异文件的 tar 包实现增量发布；本轮仅更新三个前端文件，远端 `node_modules`、`.env` 和其他项目均未触碰。
- 商城 DOM 与逻辑仍在源码中，并由 `html[data-shop-enabled="false"] [data-shop-ui]` 强制隐藏；这是后期无缝恢复所需的保留状态，不代表当前页面可见。

## 2026-08-27 动态管理数据发布发现

- Fastify 对“声明 `application/json` 但请求体为空”的请求在路由前抛出 `FST_ERR_CTP_EMPTY_JSON_BODY`。全局错误处理原先只识别 `FST_ERR_CTP_INVALID_JSON_BODY`，因此把客户端 400 误写成 500；两个解析错误必须使用同一稳定的 `400 INVALID_JSON` 契约。
- 前端正常 refresh 会发送 `{}`，所以用户浏览器会话链路本身可用；生产验收仍要覆盖畸形/空请求体，防止监控中出现可避免的 5xx。
- 隔离测试进程和生产进程共用磁盘构建时，可以先备份并原子替换文件、只重启测试进程；测试通过前生产进程继续使用内存中的旧模块。这能在不复制完整 `node_modules` 的情况下保留回滚能力。
- 最终后端和前端文件 SHA-256 分别为 `d3d0e1adb3d9ce205e92eceed4386cdae4627635546746ea1f7ddba5d26bc176` 与 `9ec45c01ed96efb23c4a6370c8e6a50357b2f9b2aed3f31e42df380e59c2075d`。

## 2026-08-27 前端状态与协商取消审计

- 角色/MBTI 和打听写入虽然已请求服务端，但部分成功分支仍直接修改浏览器对象。正确边界是 REST 返回和随后重新拉取的数据，前端缓存只能是渲染副本。
- 旧“协商取消”状态曾只放在浏览器 `CANCEL_REQUESTS` 中，刷新必然丢失，且无法向对方可靠展示。现改为 `TaskCancellationRequest` 持久化记录。
- 协商取消只允许已配对的教学任务双方在任务创建后 48 小时内发起；刚认领的 `pending` 状态不能越过发布者确认配对。
- 直接取消和协商接受统一复用退款事务：奖励型任务返还发布者冻结额，教学任务返还每位活跃认领者的冻结额，依赖幂等流水避免重复入账。
- 生产中存在未执行的商城迁移，因此不能使用会自动扫描全部待处理迁移的 `prisma migrate deploy`。本轮仅执行目标 SQL，再用 `prisma migrate resolve --applied` 记录本次迁移。

## 2026-08-27 任务事实来源第二轮审计

- “接口成功后立刻修改卡片”不是可靠的数据同步：确认配对和取消任务都可能与并发操作或实时通知竞态。写入成功后必须重拉任务、广场和余额，使页面缓存仅承担渲染职责。
- 任务列表查询若不显式 include 发布者关系，前端只能显示占位账号；直接把 Prisma `user` 关系返回又会携带 BigInt 并可能造成 Fastify 序列化 500。应选择最小字段并映射为字符串 ID 的 `publisher` DTO。
- 用户可见的通知铃铛不能混入浏览器生成的“成功”记录，否则刷新、跨设备和服务端未写入情形都会不一致。即时反馈应使用 toast，通知列表仅消费服务端记录。
- 无发布者数据时应显示明确空状态，不能用管理员昵称、角色图片或满属性作为视觉兜底；这种 UI 伪造会污染真实用户数据的判断。

## 2026-08-27 管理员发布输入结论

- 管理员路径与普通用户路径都不得用预设描述替代用户输入。前端必须在请求前校验必填字段，后端继续保留业务校验，防止空或演示数据进入 MySQL。
- 静态前端的单文件更新可在保留后端进程、依赖和数据库不变的前提下完成；发布仍需先备份、比对 SHA-256，再用 health、鉴权边界和服务日志共同验收。

## 2026-08-27 第三轮完成度审计起点

- 原始生产数据与实时化实施计划的 10 项均已有代码、自动化和生产验收证据；本轮不重复实现已完成模块。
- 根计划仍明确保留“继续审计剩余历史前端兼容函数”这一开放项；下一步以当前源码为准，检索可达的本地伪状态和硬编码业务结果。
- 已认证评价接口的生产 200 尚无不泄露凭据的自动化入口；隔离授权契约已验证 200，生产匿名边界已验证 401。本轮优先完善安全隔离烟测，不把明文凭据写进命令、脚本或报告。
- `growth-school.html` 中 `Math.random()` 的现有用途分别是登录页粒子动画、用户主动抽取并随注册请求写库的初始蛋、商城请求幂等键；均不是接口失败时展示的伪业务数据，本轮不删除。
- 三个真实任务列表容器初始为空，但对应计数节点仍写死为“找到 7 个任务”“找到 8 个求助”“找到 3 个组队”；接口尚未返回或失败时会显示虚假数量，根因是旧静态页面文案未随列表动态化一并清零。
- `goPublish(type, prefillSkill)` 可由技能入口和个人页技能入口触发；它会自动向真实发布表单写入“某技能 教学”和固定经验分享描述。虽然不会自动提交，但用户直接提交会把模板内容写入 MySQL，属于可达的硬编码任务内容路径。
- 剩余 `setTimeout` 调用均用于 toast、焦点、弹窗过渡、路由渲染等待或真实评论写入后的评论区重新展开；未发现延时伪造成功、转账或持久化状态。
- 排行榜详情先读取 `/public-profile` 再缓存渲染；`INVITE_SKILL_OPTIONS` 是用户选择邀请技能的固定选项字典，不是虚拟账号或业务记录，保留。
- 主站顶层数组/对象复核未发现非空业务记录集合：任务、通知、流水、排行榜、反馈、商城列表均以空状态初始化；现有非空集合是分类字典、页面路由、等级阈值、标签和视觉资源映射。
- 盲盒的抽取轮播文本只在等待服务端请求时做视觉循环，最终揭示严格读取 `result.action`；缺少服务端结果时退出并提示同步失败，不产生本地结果。功能目录中的题目/字段示例是输入模板，不是用户、推荐或持久化记录。
- `push/unshift/splice` 与业务集合赋值复核：持久业务列表均由 REST 结果整体替换或失败时清空；可变操作仅用于未提交表单选择、渲染行构造和推荐结果整体替换，未发现写后本地追加持久记录。
- 全部带 Count/Badge/Total/Num 的可见计数节点复扫后，不再存在非零静态初值；盲盒和主站未发现静态 `match-card`/`profile-card` 或 demo/mock 标记。
- `showUserEggModal(userName)` 不自行读取服务端，只依赖 `publicProfiles[nickname]`；排行榜入口会预先调用 `/public-profile`，但任务认领者、打听发布者/回答者/评论者多处只传昵称，真实点击可能直接提示“资料暂不可用”。
- 用户名片把服务端 `bio`、`skills` 和昵称拼接到 `innerHTML`，当前未统一 `escapeHtml`；即使写入端有敏感词过滤，也不能代替输出编码，存在跨用户 HTML 注入风险。
- 任务认领响应已经包含 `claimerId`，打听响应已经包含 `userId`；前端映射只保留昵称，丢弃了打开公开资料所需的稳定 ID。根因优先位于前端 DTO 映射与点击参数，而不是缺少按昵称查询接口。
- 服务端 `GET /api/inquiries/:id/replies` 已把回复/评论作者的 `user.id` 和顶层 `userId` 序列化为字符串；公开资料接口已存在。本缺口无需改表或新增路由，只需保留 ID 并在名片缺缓存时调用现有 `apiClient.publicProfile(id)`。
- `publicUserShape` 公开昵称、学校/专业/城市/年级、简介、MBTI、角色、稀有度、点赞和声望；明确不公开联系方式、邀请码、蛋蛋币、技能和完整统计。动态名片必须尊重此边界，对未公开值展示空状态，不能补默认资产或伪造统计。
- 各入口均有稳定 ID 可传递：任务认领者 `c.userId`、任务卡 `data-publisher-id`、排行榜 `u.id`、打听发布者 `inquiry.userId`、回答/评论 `reply.userId`/`comment.userId`。修复无需按昵称查询或新增后端能力。
- 动态输出编码复核发现：协商取消原因、任务要求、认领者昵称和联系方式从服务端/用户输入进入详情弹窗时，若直接拼接 `innerHTML` 会绕过 DOM 文本安全边界；敏感词过滤不能替代 `escapeHtml`。
- 新同步卡片 `renderSyncedClaimedTask` 已编码协商取消原因；未编码拼接集中在旧 `refreshPublishedTasks`/`refreshClaimedTasks` 和当前认领管理弹窗。前两者需先确认可达性，不可达则删除而非继续维护双实现。
- 进一步定位到旧函数名为 `refreshMyTasks` 与 `refreshPublishedTasks`，它们手工修改取消 banner/状态；当前真实写入路径已使用 `syncMyTasks()` 全量回读。下一步以调用点证明决定删除，不在死代码上继续补丁。
- 调用点检索证明 `updateTaskStatus`、`refreshMyTasks`、`showMyTaskDetail`、`showPublishedTaskDetail`、`refreshPublishedTasks` 均只有定义、没有入口，属于旧静态任务分支。
- 当前 `/api/tasks/:id/claims` 只选择认领者昵称、MBTI、声望和简介；前端因此硬编码角色为“生活互助”、稀有度为 `N`，缺失简介时伪写“已提交任务认领”。应由受权限保护的现有接口返回真实 `eggCategory`/`eggRarity`，缺失简介显示空状态。
- 工具记录：一次带多种引号的 `Select-String -Pattern` 被 PowerShell 解析为额外位置参数；改用单一 `-SimpleMatch` 后成功，不重复失败命令。

## 2026-08-27 第三轮真实性审计收口

- 旧 `updateTaskStatus`、`refreshMyTasks`、`showMyTaskDetail`、`showPublishedTaskDetail`、`refreshPublishedTasks` 以及四个取消响应函数均只有定义，没有调用入口；现行任务渲染和取消流程已经统一走 `syncMyTasks()` 与服务端 REST 回读。删除后对应标识符引用计数均为 0。
- 原有真实性契约同时要求 `showMyTaskDetail` 存在和不存在，形成不可能同时满足的测试矛盾；将旧断言改为全页面禁止伪造发布者身份、头像、满属性和稀有度后，仍保持原业务约束且允许清理不可达函数。
- 用户名片在缓存缺失时必须依赖稳定用户 ID 请求公开资料；服务端未公开的技能、资产和统计只能展示明确空状态，不能从昵称、文字或前端默认值推断。
- 认领管理应使用任务认领 DTO 返回的真实 `eggCategory` 与 `eggRarity`；缺失资料显示“未填写”，所有昵称、简介、联系方式和状态均需要编码后进入 HTML。
- 生产增量比对确认 `api-client.js` 和盲盒 `app.js` 与线上一致，实际只需覆盖后端 `app.js` 和主页面，避免无意义上传与扩大回滚面。

## 2026-08-27 总完成度审计发现

- 独立持续测试任务没有停止，10 分钟 heartbeat 正常；最新一轮仍因本机 `E2E_ADMIN_IDENTIFIER`、`E2E_ADMIN_PASSWORD` 未注入且 `127.0.0.1:13311` 未监听，只完成生产只读检查。
- 远端隔离测试服务 `dandan-world-test` 当前在线，回环 `3311/health` 返回 `status=ok`，且部署目录存在 `.env.test`；可在不输出值的前提下进一步检查 E2E 专用变量名并建立 SSH 隧道。
- `server/scripts/isolated-e2e.mjs` 固定只连接 `127.0.0.1:13311`，覆盖管理员权限、注册/邀请码、Cookie 刷新、资料二次编辑、任务审核与持久化、打听、盲盒、好友聊天、排行榜和三类 WSS 事件，能够补齐持续报告的六类未执行项。
- 实施计划任务 10 声称已创建 `server/.env.test.example`，但当前本地文件不存在；这是交付清单与文件事实不一致，需补充无秘密模板和契约校验。

## 2026-08-27 隔离 E2E 启动器修复与验收

- Windows PowerShell/.NET 不支持静态 `RandomNumberGenerator.GetBytes(length)`；启动器改用 `Create()` 实例填充字节数组，临时密码仍来自加密安全随机源且不输出。
- 远端 Node 20 不接受 `fs/promises.readFile(0, 'utf8')`；管理员引导改为异步消费 `process.stdin`，消除 `ERR_INVALID_ARG_TYPE`。
- 测试部署目录缺少 `scripts`；已只在隔离测试路径创建并上传引导脚本，生产目录、服务、生产库与商城迁移均未触碰。
- 当前轮成功建立隔离管理员和 `127.0.0.1:13311` SSH 隧道，23/23 真实写入 E2E 用例通过；报告不包含密码、Cookie、JWT、私钥或连接串。
- 启动器问题修复后，本机完整回归为 44 个测试文件、249/249 通过，TypeScript 构建成功；持续回归任务也已复用启动器完成独立首轮 23/23。

## 2026-08-27 好友模块历史风险复核

- 早期记录的关系选择排序、长会话窗口、待处理申请“回复”入口、推荐空结果残留和收件箱 XSS 风险均已由当前实现收口：关系同级按 `updatedAt` 取新，聊天查询最新 100 条后反转，前端只为已接受好友显示聊天入口，空推荐会清空渲染列表，收件箱用户内容统一经 `escapeHtml` 输出。
- 本次不重写已覆盖的功能、不修改数据库结构；完整隔离 E2E 已覆盖好友申请去重、未接受时拒绝聊天、接受后聊天与私有实时事件。
- 已复核 GitHub 开源 RBAC 调研文档：本期继续采用现有 Prisma/MySQL 统一 RBAC，不引入 Casbin Prisma adapter、OpenFGA、Permify、Ory Keto 或 Cerbos 常驻服务。具体兼容性和决策依据见 `docs/research/2026-08-26-rbac-open-source-options.md`。
## 2026-08-27 敏感词误杀与卡顿根因

- 通用 GFW 词表 `zh-sensitive-words.txt` 共 51343 行，包含“四六级”“教师资格证”“俄罗斯”“共产党”等大量正常校园词汇；直接用作内容过滤会造成注册、资料、任务和反馈文本被误杀。
- 前端 `sensitive-filter.js` 在页面加载时同步构建 5 万余词的 Trie，文件约 574KB，是首屏卡顿来源之一；改为约 2KB 的高信号词表后，误杀与首屏阻塞同时消除。
- 公开资料接口按 `publicUserShape` 不返回技能，前端缓存此前在排行榜路径写入 `skills:[]`、在打听路径写入 `skills:null`，类型不一致；统一为 `[]`，邀请弹窗按预期回退到完整技能选项。
- 邀请入口需要稳定的目标用户 ID；上一轮已为打听回答/评论/发布者传入 `authorId`/`publisherId`，本轮补上对当前用户隐藏邀请按钮，避免后端拒绝自邀。
## 2026-08-28 全站回归与版本边界发现

- 完整隔离 E2E 25/25 通过，业务回归未发现新的功能缺陷；浏览器新会话确认登录身份来自服务端，退出后盲盒 iframe 卸载且 17 秒内无定时轮询。
- 发现真实流程缺陷：docs/releases/2026-08-28-auth-profile-task-ui.json 记录的主页面和 API client 哈希与当前源码不一致，旧版本不能继续作为当前版本使用。
- 发现更高风险的门禁缺陷：原 verify-release-boundary.mjs 没有区分历史 superseded、隔离测试和生产批准版本；旧清单可被普通验证接受，部署脚本又未强制清单或生产状态。
- 修复：建立 2026-08-28-auth-profile-task-ui-r2.json 与 docs/releases/index.json；r1 标记 superseded；生产校验要求 production-approved 且 productionDeployable=true；部署脚本强制显式清单并使用 /var/www/dd。
- 失败命令记录：定向 Vitest 最初从仓库根路径传入 server/tests/...，因 Vitest include 目录为 tests/**/*.test.ts 返回 No test files；改为在 server 目录使用 tests/... 后通过。一次 PowerShell 多文件补丁模板字符串转义错误未产生文件改动，随后拆分补丁成功。
- 上一轮完整回归为 53 个测试文件、311/311；本轮新鲜完整回归为 53 个测试文件、315/315。两轮均完成 TypeScript 构建、r2 哈希校验、生产状态拒绝、部署脚本语法和差异空白检查。
- 主页面静态结构为 1362 个 `<div>` 开标签和 1362 个闭标签，`#stage` ID 唯一，且代码中存在 2 个初始化查询引用。
- Windows PATH 未暴露 `bash.exe`，但 Git Bash 位于 `C:\Program Files\Git\bin\bash.exe`；使用该绝对路径完成 `bash -n`。两次工具包装语法错误发生在 shell 启动前，对仓库无影响。
