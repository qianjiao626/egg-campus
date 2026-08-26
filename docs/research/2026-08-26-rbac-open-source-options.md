# 蛋蛋校园 RBAC 与反馈附件开源方案调研

> 调研日期：2026-08-26
> 目标栈：Node.js + TypeScript + Fastify 5 + Prisma 6 + MySQL
> 范围：只评估可复用的开源能力，不建议直接搬运整套后台、客服或工单系统。

## 结论先行

当前项目最合适的方案是：

1. 用 Prisma/MySQL 建立项目自己拥有的规范化 RBAC 数据模型：`Role`、`Permission`、`RolePermission`、`RoleInheritance`、`UserRoleGrant`、`RoleGrantAudit`。
2. 用 `@casl/ability` 做进程内的授权判定，用 `@casl/prisma` 把“只能查看自己的反馈”等资源级权限转成 Prisma `WhereInput`。
3. 管理员有效期保存在 `UserRoleGrant.startsAt/expiresAt/revokedAt`，每次需要管理权限的请求都使用服务端时间查询有效授权，不能只相信 JWT 中缓存的角色。
4. 两个固定根账号属于项目的业务不变量：根角色不可由网页授予，两个根授权永久且不可撤销；普通管理员即使选择“永久”，也不能拥有授权他人的权限。
5. 反馈时间线自行建轻量领域模型，文件上传只复用 `@fastify/multipart` 和文件签名识别库。不要搬运整套客服系统，因为现有需求的状态、权限、重开次数、附件隐藏和未读规则都已经高度定制。

这仍然是用户选择的“完整通用 RBAC”方向，只是把职责拆清楚：数据库负责角色、继承、期限和审计；CASL 负责稳定、可测试的资源授权表达。它不是在现有 `User.role` 上继续堆条件判断。

## 项目约束对方案的影响

- 当前后端已经使用 Prisma 6 和 MySQL，新增第二套 ORM 或第二种生产数据库会提高迁移、备份和故障恢复成本。
- 当前只部署在一台腾讯云 CVM，单独增加授权服务会增加端口、进程、健康检查、数据备份和故障点。
- 权限必须支持立即过期。JWT 内若保存 `admin` 并一直信任到 token 过期，会违反“到期立即降级”的规则。
- “用户只能看自己的反馈”“只有有效管理员能看受保护附件”是资源级权限，不只是页面菜单级 RBAC。
- 根账号保护、30 天昵称冷却、反馈重开一次等属于业务规则，任何通用授权库都不能替代这些约束。

## 候选方案对比

维护活跃度数据来自 GitHub 官方仓库/API 的 2026-08-26 快照；星标只作为生态规模信号，不作为安全或质量证明。

| 官方仓库 | 是否归档 | 最近推送（UTC） | 星标快照 |
| --- | --- | --- | --- |
| [stalniy/casl](https://github.com/stalniy/casl) | 否 | 2026-08-26 | 7,055 |
| [apache/casbin-node-casbin](https://github.com/apache/casbin-node-casbin) | 否 | 2026-08-13 | 2,916 |
| [apache/casbin-node-casbin-prisma-adapter](https://github.com/apache/casbin-node-casbin-prisma-adapter) | 否 | 2026-06-04 | 47 |
| [openfga/openfga](https://github.com/openfga/openfga) | 否 | 2026-08-25 | 5,659 |
| [Permify/permify](https://github.com/Permify/permify) | 否 | 2026-08-26 | 5,939 |
| [ory/keto](https://github.com/ory/keto) | 否 | 2026-08-24 | 5,389 |
| [cerbos/cerbos](https://github.com/cerbos/cerbos) | 否 | 2026-08-26 | 4,554 |
| [fastify/fastify-multipart](https://github.com/fastify/fastify-multipart) | 否 | 2026-08-14 | 540 |
| [sindresorhus/file-type](https://github.com/sindresorhus/file-type) | 否 | 2026-08-15 | 4,321 |

| 方案 | 许可证 | 运行形态 | 角色继承 / 资源权限 | 限时授权 | 与当前栈的摩擦 | 判断 |
| --- | --- | --- | --- | --- | --- | --- |
| CASL (`@casl/ability` + `@casl/prisma`) | MIT | Node 进程内库 | 条件式资源权限强；角色/继承由应用组装 | 由 `UserRoleGrant` 查询有效期后生成 Ability | 直接支持 Prisma 4.16+；当前 Prisma 6 可用 | **推荐** |
| node-casbin | Apache-2.0 | Node 进程内库 | 原生 RBAC、传递式角色继承、ABAC、资源角色 | Node 绑定当前无直接 Conditional RoleManager；需应用层过滤或自定义模型 | 官方 Prisma adapter 当前要求 Prisma 7 且带 PostgreSQL 驱动 | 可选，但本项目收益低于 CASL |
| OpenFGA | Apache-2.0 | 独立 HTTP/gRPC 服务 | Zanzibar/ReBAC 很强，支持关系继承和条件元组 | 原生条件元组可表达时间窗口 | 支持 MySQL 8，但多一个服务、数据存储和 SDK 网络调用 | 未来复杂关系场景候选 |
| Permify CE | AGPL-3.0（服务端） | 独立 HTTP/gRPC 服务 | RBAC/ReBAC/ABAC DSL | 可通过属性/上下文建模，但需额外数据同步 | 生产存储官方要求 PostgreSQL 13.8+，与现有 MySQL 分离 | 不选 |
| Ory Keto | Apache-2.0 | 独立授权服务 | Zanzibar/ReBAC，适合大量关系 | 需要关系/上下文模型配合 | 可配 MySQL，但运维明显增加；官方对关键自托管工作负载强调商业支持 | 不选 |
| Cerbos PDP | Apache-2.0 | 独立无状态 PDP | YAML 资源策略、RBAC + ABAC、derived roles | 应用把当前时间/有效角色作为上下文传入 | 仍需自建角色期限表，并增加一个常驻进程；当前 JS gRPC SDK要求 Node 22 | 不选 |

### 1. CASL

**适配点**

- CASL 官方提供“roles with persisted permissions”方案，明确给出把角色/权限保存在关系数据库、每次请求构造 Ability 的模式。
- `@casl/prisma` 使用 Prisma `WhereInput` 表达规则，并提供 `accessibleBy` 生成数据库过滤条件。这正适合“普通用户只能读取自己的反馈，管理员可读取全部”一类要求。
- 官方 README 说明 `@casl/prisma` 要求 Prisma Client 4.16.0 或更高；项目当前为 Prisma 6.19.0，处于兼容范围。
- `@casl/ability` 和 `@casl/prisma` 当前 npm 最新版本分别为 7.0.1 和 2.0.2，许可证均为 MIT；主仓库未归档，2026-08-26 仍有提交。

**边界**

- CASL 是授权规则计算器，不会替项目创建 `Role`、`Permission`、期限、审计表，也不会保护两个根账号。
- CASL 没有必须采用的“角色继承表”。项目应在加载权限时展开 `RoleInheritance`，做循环检测，再把权限编译为 Ability rules。
- 有效期不要塞进前端规则。服务端先查询 `startsAt <= now`、`revokedAt IS NULL`、`expiresAt IS NULL OR expiresAt > now` 的授权，再创建 Ability。

**为什么推荐**

它复用了最难写对的资源级判定和 Prisma 查询过滤，同时让期限、根账号、审计仍保存在项目已有 MySQL 中。没有新服务、没有第二套 ORM，也不会把授权数据复制到另一个存储。

### 2. node-casbin

**优势**

- Casbin 原生支持 RBAC、ABAC、资源角色和多个角色系统。
- 官方 RBAC 文档明确角色继承是传递的，并提供 implicit roles/permissions API。
- node-casbin 是 TypeScript/Node 进程内库，当前 npm `casbin` 版本为 5.51.1，Apache-2.0；官方仓库未归档，2026-08-13 仍有提交。

**当前项目的关键摩擦**

- Casbin 的通用文档展示了 Conditional RoleManager 和时间窗口角色，但当前 node-casbin 源码中没有对应的 `ConditionalRoleManager`、`addNamedLinkConditionFunc` 或 `TimeMatchFunc` 实现。因此不能把 Go 版文档示例直接当成 Node 版已有能力。
- 官方 `casbin-prisma-adapter` npm 最新版本 1.12.0 的 peer dependency 要求 Prisma 7.2，并直接依赖 `@prisma/adapter-pg`/`pg`；这与当前 Prisma 6 + MySQL 不兼容。
- 可以自行实现 Casbin adapter，或只让 Casbin保存权限策略、让应用数据库保存限时用户角色，但这会产生两套模型之间的同步责任。

**采用条件**

只有在团队明确希望用 Casbin model/policy DSL 管理大量动态策略，并愿意维护自定义 Prisma/MySQL adapter 时再选。对于本次以“用户自己的资源 + 少量后台权限”为主的系统，CASL 更贴近现有查询层。

### 3. OpenFGA

**优势**

- 官方定位为 Zanzibar 风格的细粒度授权服务，支持 HTTP/gRPC、Node SDK、关系继承和条件关系元组。
- 条件文档直接给出了 `current_time < grant_time + grant_duration` 的非过期授权模型，限时关系表达比其他候选更原生。
- 官方 README 列出 PostgreSQL、MySQL、内存和 beta SQLite；生产支持 MySQL 8。
- 服务端 Apache-2.0，仓库未归档，2026-08-25 仍有提交。

**不在本期采用的原因**

- 需要额外运行 OpenFGA 服务、维护 store/model/tuple，授权检查变成网络调用。
- 用户、角色和期限仍要与业务 MySQL 保持一致；审计和两个根账号保护仍需本项目实现。
- 条件检查中的 `current_time` 是请求上下文，必须由可信后端注入，绝不能接受浏览器传入的时间。

当项目发展到多租户、群组层级、好友/组织/资源关系大量交叉，并需要跨多个后端共享授权时，再评估迁移到 OpenFGA。

### 4. Permify

- Permify 是独立授权服务，支持 RBAC、ReBAC、ABAC DSL，Node SDK 使用 Apache-2.0。
- Permify 服务端仓库许可证为 AGPL-3.0，使用前需要做许可证合规评估。
- 官方生产数据库文档只列 PostgreSQL 13.8+，内存存储不适合生产。这意味着现有 MySQL 之外还要维护 PostgreSQL。
- Community Edition 需要自行负责容量、升级、备份、可用性和安全；官方 README 还说明云版与 CE 的发布节奏和功能不同。

因此它对当前单体 Fastify 应用属于明显过度设计。

### 5. Ory Keto

- Keto 是 Zanzibar/ReBAC 风格的独立授权服务器，Apache-2.0，官方说明可使用 PostgreSQL、MySQL 和 CockroachDB。
- 它适合海量关系和横向扩展，不适合仅为两个根管理员和若干限时管理员增加一套独立授权基础设施。
- 当前官方 README 明确称开源自托管版适合实验、原型或不重要且无 SLA 的工作负载，并建议关键业务通过商业协议获得稳定安全更新和支持。对本项目而言，这个运维和支持边界没有必要承担。

### 6. Cerbos

- Cerbos 是独立、无状态的 Policy Decision Point，以 YAML 定义资源策略，支持 RBAC、ABAC、derived roles，并有 Prisma query plan adapter。
- 它不保存项目用户的角色期限；应用仍要从 MySQL 取出有效角色和属性后传给 Cerbos。
- 当前 `@cerbos/grpc` npm 版本 0.29.0 要求 Node.js 22 或以上，部署前还要升级并锁定服务器 Node 版本。

它适合多个服务共享 GitOps 策略的阶段，不适合当前单服务部署。

## 推荐的 RBAC 数据职责

以下不是最终 Prisma schema，而是实现时必须保持的边界：

| 模型 | 责任 | 关键约束 |
| --- | --- | --- |
| `Role` | 角色定义，如 user/admin/root | `key` 唯一；root 不可通过 UI 创建或授予 |
| `Permission` | 稳定权限键，如 `feedback.read.any` | `key` 唯一；权限键由代码白名单约束 |
| `RolePermission` | 角色拥有的权限 | `(roleId, permissionId)` 唯一 |
| `RoleInheritance` | 子角色继承父角色权限 | `(childRoleId, parentRoleId)` 唯一；写入时拒绝自环和循环 |
| `UserRoleGrant` | 当前用户角色关系和有效期 | 每个 `(userId, roleId)` 只有一条当前关系；重复授权更新此记录 |
| `RoleGrantAudit` | 授予、续期、永久化、撤销历史 | 只追加，不覆盖；记录操作者、前后值、原因、时间 |

`UserRoleGrant` 建议字段：`startsAt`、`expiresAt nullable`、`revokedAt nullable`、`grantedByUserId`、`updatedAt`。`expiresAt = NULL` 表示永久。重复授权根据已确认规则更新现有关系，历史变化写入 `RoleGrantAudit`，避免重复有效授权。

### 每次请求的判定顺序

1. 验证会话和用户是否有效。
2. 若 `mustChangePassword = true`，只允许修改密码和退出登录。
3. 使用数据库服务器/应用服务器可信时间加载有效 `UserRoleGrant`。
4. 展开角色继承和权限，构造 CASL Ability。
5. API 层检查动作权限；查询层用 `accessibleBy` 或等价的强制 `where` 限制资源范围。
6. 管理操作在事务内再次检查操作者权限和目标用户保护规则，再写业务变更与审计日志。

不要仅依赖前端隐藏按钮，也不要仅依赖登录时写入 JWT 的角色。JWT 可以带 `authzVersion` 或会话 ID 用于缓存失效，但敏感管理接口仍必须确认当前授权未过期。

## 反馈时间线与附件：复用库，不搬整套系统

### 为什么不搬客服/工单项目

已确认的反馈流程包含：`待处理 / 处理中 / 待修改 / 已解决 / 已驳回`、待修改时用户补充、管理员多轮回复、逐条未读、结束后 7 天内仅可重开一次、附件可隐藏但不物理删除。这些规则已经比通用客服系统的默认流程更具体。搬运整套系统会同时带入账户、队列、SLA、通知、存储和前端壳，后续删改成本高于实现当前小领域。

建议只建：

- `Feedback`：所有者、类型、当前状态、解决/驳回时间、重开次数。
- `FeedbackMessage`：发送者、发送者类型、文本、创建时间，形成不可覆盖的时间线。
- `FeedbackAttachment`：所属消息、磁盘键、真实 MIME、字节数、隐藏时间、隐藏人、隐藏原因。
- `FeedbackReadReceipt` 或按参与者维护的最后已读消息序号：实现逐条记录未读，不在进入标签时批量清空。
- `FeedbackStatusEvent`：状态前后值、操作者、时间和原因，便于审计。

### 上传解析：`@fastify/multipart`

推荐采用 `@fastify/multipart`：

- 它是 Fastify 官方生态插件，MIT，支持异步迭代、流式处理、文件数量/大小/parts 限制。
- 官方文档强调所有文件流必须消费，否则请求不会完成；也提醒不要使用用户文件名直接写盘，避免覆盖敏感文件。
- 当前 npm 最新版本 10.1.1，适合 Fastify 5 项目。

本项目应在路由级明确设置：每次最多 3 个文件、每个 5 MiB、合理的字段和 parts 上限，并在超限或中断时删除临时文件。不要用 `attachFieldsToBody` 把文件全部无界加载进内存。

### 文件内容校验：`file-type`

浏览器提供的扩展名和 `Content-Type` 都不可信。推荐用 `file-type` 检查二进制 magic number，只接受检测结果为：

- `image/jpeg` / `jpg`
- `image/png` / `png`
- `image/webp` / `webp`

但官方明确说明 magic-number 检测只是 best-effort 提示，不能证明文件完整或无恶意。因此还应限制大小；若后续要生成缩略图或严格验证解码，可在隔离/限时条件下增加成熟图片解码器。当前需求无需先引入完整图片处理流水线。

版本要跟服务器 Node.js 对齐：`file-type@22.0.2` 要求 Node 22+；若 CVM 仍是 Node 20，可锁定 `file-type@21.1.1`（Node 20+）；若仍是 Node 18，可锁定 `20.5.0`。上线前应先读取远端 `node --version`，不能盲装最新版本。

### 受保护存储与下载

1. 附件目录放在蛋蛋校园独立的非 Web 根目录，例如项目的私有 data 目录，不能放入 Nginx 可直接访问的 `/var/www`，也不使用“航线”的 Supabase。
2. 文件名由服务端生成随机 ID，只在数据库保存原始展示名；禁止把用户文件名拼进路径。
3. 先写同文件系统临时目录，完成大小和 magic-number 检查后原子移动；数据库失败时清理文件，文件移动失败时回滚数据库事务或标记待清理。
4. 下载/预览必须经过登录路由。服务端查询 `Feedback` 所有者以及调用者的当前有效管理员权限后再读取文件。
5. 响应设置准确 `Content-Type`、`X-Content-Type-Options: nosniff` 和受控 `Content-Disposition`；不暴露真实磁盘路径。
6. “管理员隐藏”只写 `hiddenAt/hiddenBy/reason`，普通用户接口不再返回文件内容；原文件保留用于审计。

## 不建议直接搬运的内容

- 不搬第三方 RBAC 后台 UI：它无法自动满足两个不可撤销根账号、限时选项说明、重复授权更新和本项目中文交互。
- 不搬 NestJS/Express/Next.js RBAC 模板：框架、认证中间件和数据访问方式不同，复制后需要拆除大量胶水代码。
- 不引入 `casbin-prisma-adapter` 当前版本：Prisma 7/PostgreSQL 依赖与现状冲突。
- 不引入 Permify/OpenFGA/Keto/Cerbos 常驻服务作为本期依赖：现有规模不足以抵消运维复杂度。
- 可以借鉴这些项目的策略测试思想，但最终权限键、角色矩阵、期限测试和根账号保护测试必须写在蛋蛋校园仓库内。

## 建议实施顺序

1. 先写角色/权限矩阵和固定权限键，确认 `root`、`admin`、`user` 的继承方向。
2. 新增规范化 Prisma 模型及迁移，保留旧 `User.role` 作为短期兼容字段，完成数据回填后再逐步停止读取。
3. 实现统一 `AuthorizationService`，集中处理有效期、继承、CASL Ability 和根账号保护。
4. 先迁移一个低风险接口，再迁移所有管理员接口和“只能看自己”的接口；默认拒绝未知权限。
5. 完成授权、续期、撤销、到期立即失效、根账号不可操作、角色继承循环拒绝、普通用户越权拒绝等测试。
6. 实现反馈时间线和逐条已读，再接 `@fastify/multipart`、文件签名检测和受保护下载。
7. 最后制作“用户与权限”管理界面，期限选项旁显示已确认的解释文案。

## 一手来源

### CASL

- [CASL 官方仓库](https://github.com/stalniy/casl)
- [CASL：数据库持久化角色权限官方教程](https://github.com/stalniy/casl/blob/master/docs-src/src/content/pages/cookbook/roles-with-persisted-permissions/en.md)
- [CASL Prisma 官方 README](https://github.com/stalniy/casl/blob/master/packages/casl-prisma/README.md)
- [npm：@casl/ability latest](https://registry.npmjs.org/%40casl%2Fability/latest)
- [npm：@casl/prisma latest](https://registry.npmjs.org/%40casl%2Fprisma/latest)

### Casbin

- [node-casbin 官方仓库](https://github.com/apache/casbin-node-casbin)
- [Casbin 官方 RBAC 文档](https://casbin.org/docs/rbac)
- [Casbin 官方 RBAC with Conditions 文档](https://casbin.org/docs/rbac-with-conditions)
- [Casbin Prisma Adapter 官方仓库](https://github.com/apache/casbin-node-casbin-prisma-adapter)
- [Casbin Prisma Adapter package.json](https://github.com/apache/casbin-node-casbin-prisma-adapter/blob/master/package.json)
- [npm：casbin-prisma-adapter latest](https://registry.npmjs.org/casbin-prisma-adapter/latest)

### 独立授权服务

- [Permify 官方仓库与 CE 说明](https://github.com/Permify/permify)
- [Permify 官方生产数据库配置](https://github.com/Permify/permify/blob/master/docs/setting-up/installation/database.mdx)
- [Ory Keto 官方仓库与自托管边界](https://github.com/ory/keto)
- [OpenFGA 官方仓库、存储与生产说明](https://github.com/openfga/openfga)
- [OpenFGA 官方 Conditions 文档](https://github.com/openfga/openfga.dev/blob/main/docs/content/modeling/conditions.mdx)
- [OpenFGA 官方时间与上下文授权文档](https://github.com/openfga/openfga.dev/blob/main/docs/content/modeling/contextual-time-based-authorization.mdx)
- [Cerbos 官方仓库与架构说明](https://github.com/cerbos/cerbos)
- [npm：@cerbos/grpc latest](https://registry.npmjs.org/%40cerbos%2Fgrpc/latest)

### 上传与文件识别

- [@fastify/multipart 官方仓库和限制说明](https://github.com/fastify/fastify-multipart)
- [npm：@fastify/multipart latest](https://registry.npmjs.org/%40fastify%2Fmultipart/latest)
- [file-type 官方仓库和安全边界](https://github.com/sindresorhus/file-type)
- [npm：file-type registry](https://registry.npmjs.org/file-type)
