# 蛋蛋世界：CVM 自托管 MySQL 数据库建设任务进度清单

## 项目目标

建立可用于生产演进的南京 CVM 自托管 MySQL 数据层，先安全保存用户数据，再逐步接入任务、蛋蛋币、评价、通知和管理后台。

前端只通过后端接口访问数据库，不允许浏览器直接连接 TencentDB。

## 方案假设

- 数据库：南京 CVM 上自托管 MySQL 8.0
- 存储引擎：InnoDB
- 字符集：UTF8MB4
- 访问方式：后端服务和数据库同机时通过 `127.0.0.1:3306` 连接
- 一期范围：用户注册/登录、用户资料、五维统计、角色解锁、蛋蛋币账户及流水
- 二期范围：任务、认领配对、提交验收、评价、通知、反馈和自动退款

## 进度总览

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0 | 需求冻结与领域规则确认 | 进行中 |
| 1 | 腾讯云资源、网络和安全配置 | 待开始 |
| 2 | 数据库 Schema、迁移和种子数据 | 待开始 |
| 3 | 用户数据 API 与认证 | 待开始 |
| 4 | 前端数据层接入与兼容迁移 | 待开始 |
| 5 | 任务、蛋蛋币、评价和通知闭环 | 待开始 |
| 6 | 测试、备份、监控和上线验收 | 待开始 |

## 阶段 0：需求与技术方案确认

- [ ] 确认数据库版本：推荐 TencentDB for MySQL 8.0
- [ ] 确认后端技术栈
  - 推荐：Node.js + Fastify/NestJS + Prisma 或 Knex
  - 也可以使用 Java/Spring Boot、Go 等，但必须统一数据库迁移工具
- [ ] 确认后端部署位置
  - 推荐与数据库放在同一腾讯云 VPC
  - 不允许前端浏览器直连数据库
- [ ] 确认环境划分：`development`、`staging`、`production`
- [ ] 确认用户登录方式
  - 一期：邮箱/昵称 + 密码
  - 后续：手机号、微信或其他第三方登录
- [ ] 确认新用户初始蛋蛋币数量
- [ ] 确认是否允许管理员发放蛋蛋币
- [ ] 确认是否接入充值

**阶段验收：**

形成一页技术决策记录，明确数据库版本、后端框架、部署方式、登录方式和环境划分。

## 阶段 1：CVM MySQL、网络和安全配置

- [ ] 确认 CVM 操作系统和 MySQL 版本
- [ ] 确认 MySQL 服务名：`mysql` 或 `mysqld`
- [ ] 确认 MySQL 监听 `127.0.0.1:3306`
- [ ] 如果后端和数据库不同机，再配置 CVM 内网地址、VPC 和安全组
- [ ] 同机部署时不开放公网 3306
- [ ] 开启 MySQL TLS（跨主机连接时必须）
- [ ] 创建独立数据库账号
  - `migration_user`：执行数据库迁移
  - `app_user`：后端运行时使用，限制权限
  - `readonly_user`：统计或报表查询
- [ ] 禁止应用使用 root 账号连接
- [ ] 将密码保存到腾讯云密钥管理或服务端环境变量
- [ ] 设置字符集为 `utf8mb4`
- [ ] 统一数据库时区，推荐使用 UTC，展示层转换为北京时间
- [ ] 设置 `mysqldump` 或备份脚本的周期和保留时间
- [ ] 开启 MySQL 慢查询、连接数、CPU、磁盘空间监控
- [ ] 配置 CVM 和进程级告警

**阶段验收：**

后端可以通过 `127.0.0.1:3306` 成功连接数据库；公网无法使用应用账号直接访问；备份策略和告警策略已经配置。

## 阶段 2：一期数据库 Schema、迁移和种子数据

一期只做用户和基础账户数据，不要一开始把所有业务表一次性做完。

### 2.1 用户身份表 `users`

- [ ] `id`
- [ ] `nickname`
- [ ] `email`
- [ ] `phone`
- [ ] `password_hash`
- [ ] `role`
- [ ] `status`
- [ ] `school`
- [ ] `major`
- [ ] `city`
- [ ] `grade`
- [ ] `age`
- [ ] `bio`
- [ ] `mbti_type`
- [ ] `mbti_group`
- [ ] `likes`
- [ ] `reputation`
- [ ] `egg_category`
- [ ] `egg_rarity`
- [ ] `invite_code`
- [ ] `created_at`
- [ ] `updated_at`
- [ ] `last_login_at`

必须建立的约束：

- [ ] `nickname` 唯一
- [ ] `email` 唯一或允许为空
- [ ] `phone` 唯一或允许为空
- [ ] `role` 只能是 `student` / `admin`
- [ ] `status` 支持 `active` / `suspended` / `deleted`
- [ ] 密码只保存哈希，不保存明文密码

### 2.2 登录会话表 `auth_sessions`

交接文档中没有这张表，但真实登录需要保存会话：

- [ ] `id`
- [ ] `user_id`
- [ ] `session_token_hash`
- [ ] `refresh_token_hash`
- [ ] `expires_at`
- [ ] `revoked_at`
- [ ] `ip`
- [ ] `user_agent`
- [ ] `created_at`

### 2.3 用户五维统计表 `user_stats`

- [ ] `user_id`
- [ ] `knowledge`
- [ ] `skills`
- [ ] `charm`
- [ ] `money`
- [ ] `reputation`
- [ ] `completed_tasks`
- [ ] `published_tasks`
- [ ] `updated_at`

### 2.4 用户角色表 `user_characters`

- [ ] `user_id`
- [ ] `category`
- [ ] `unlocked`
- [ ] `count`
- [ ] `is_current`
- [ ] `unlocked_at`
- [ ] 建立 `(user_id, category)` 唯一约束

### 2.5 蛋蛋币账户表 `point_accounts`

不要只在 `users.points` 中保存余额，推荐拆出账户表：

- [ ] `user_id`
- [ ] `available_balance`
- [ ] `frozen_balance`
- [ ] `version`
- [ ] `updated_at`

`version` 用于乐观锁，防止并发扣款。

### 2.6 蛋蛋币流水表 `point_transactions`

比简单的 `point_logs` 更适合真实结算：

- [ ] `id`
- [ ] `user_id`
- [ ] `type`
- [ ] `delta_available`
- [ ] `delta_frozen`
- [ ] `balance_available`
- [ ] `balance_frozen`
- [ ] `task_id`
- [ ] `idempotency_key`
- [ ] `operator_id`
- [ ] `remark`
- [ ] `created_at`

必须保证：

- [ ] 每次余额变化都有流水
- [ ] 同一个 `idempotency_key` 不能重复结算
- [ ] 冻结、释放、退款、奖励都可追溯
- [ ] 余额更新和流水写入处于同一个事务

### 2.7 审计日志表 `audit_logs`

用于记录管理员和关键资金操作：

- [ ] `id`
- [ ] `actor_id`
- [ ] `action`
- [ ] `target_type`
- [ ] `target_id`
- [ ] `before_data`
- [ ] `after_data`
- [ ] `ip`
- [ ] `created_at`

### 2.8 迁移和种子数据

- [ ] 选择并配置迁移工具
- [ ] 编写初始建表迁移
- [ ] 编写索引、外键和唯一约束
- [ ] 编写测试环境种子数据
- [ ] 创建初始管理员账号
- [ ] 禁止将 Demo 假数据直接导入生产库
- [ ] 编写回滚迁移
- [ ] 在本地和测试库各执行一次迁移

**阶段验收：**

执行迁移后，所有表、索引、外键、唯一约束和初始管理员账号均创建成功；测试脚本可以完成用户注册、账户初始化和流水写入。

## 阶段 3：用户 API 与认证

- [ ] `POST /api/auth/register`
- [ ] `POST /api/auth/login`
- [ ] `POST /api/auth/logout`
- [ ] `POST /api/auth/refresh`
- [ ] `GET /api/users/me`
- [ ] `PUT /api/users/me`
- [ ] `GET /api/users/me/stats`
- [ ] `GET /api/users/me/characters`
- [ ] `PUT /api/users/me/characters/current`
- [ ] `GET /api/users/me/point-account`
- [ ] `GET /api/users/me/point-transactions`
- [ ] `GET /api/users/:id/public-profile`

安全要求：

- [ ] 密码使用 Argon2id 或 bcrypt
- [ ] 登录接口限流
- [ ] 统一错误信息，避免暴露用户是否存在
- [ ] 所有用户接口校验当前登录身份
- [ ] 管理接口要求 `admin` 角色
- [ ] 公开用户资料不返回邮箱、手机号、密码哈希和内部字段
- [ ] 记录登录失败和异常操作

**阶段验收：**

注册后关闭页面再重新登录，用户资料、角色、蛋蛋币余额和流水仍然存在；普通用户无法访问管理员接口。

## 阶段 4：前端数据层接入

当前前端变量需要逐步替换：

- [ ] `USER` → `/api/users/me`
- [ ] `REGISTERED_USERS` → 后端用户表
- [ ] `CHAR_STATE` → 用户角色接口
- [ ] `pointLogs` → 蛋蛋币流水接口
- [ ] `USER_DB` → 用户公开资料接口
- [ ] `notifications` → 通知接口

建议先建立统一前端数据模块：

```javascript
const api = {
  async get(path) {},
  async post(path, body) {},
  async put(path, body) {},
  async delete(path) {}
};
```

接入顺序：

- [ ] 先接注册和登录
- [ ] 再接个人资料
- [ ] 再接蛋蛋币账户和明细
- [ ] 再接角色和五维属性
- [ ] 最后移除对应的内存模拟逻辑
- [ ] 增加加载态、错误态和登录过期处理
- [ ] 保留 Demo 数据作为开发环境种子数据，不混入生产库

**阶段验收：**

刷新页面后数据不丢失；打开不同浏览器或设备登录同一账号，看到的用户资料和余额一致。

## 阶段 5：任务与交易闭环

在一期用户数据稳定后，再创建以下表：

- [ ] `tasks`
- [ ] `task_claims`
- [ ] `task_submissions`
- [ ] `task_events`
- [ ] `ratings`
- [ ] `notifications`
- [ ] `feedback_tickets`
- [ ] `gossip_posts`
- [ ] `gossip_answers`

重点改造：

- [ ] 统一 `teach`、`help`、`team`、`reward` 任务状态机
- [ ] 区分任务状态、认领状态、提交状态和结算状态
- [ ] 防止发布者认领自己的任务
- [ ] 防止重复认领和重复提交
- [ ] 求助型允许超额报名，但最终指派人数受限
- [ ] 组队型实现搭子选择和双方确认
- [ ] 补齐组队型经验值和互评
- [ ] 联系方式只在配对后返回
- [ ] 教学型、求助型、组队型分别实现结算事务
- [ ] 实现自动退款定时任务
- [ ] 增加取消、退回修改、申诉和客服介入状态

**阶段验收：**

完整跑通：注册 → 发布任务 → 审核 → 认领/报名 → 配对 → 提交 → 验收 → 结算 → 评价 → 通知。

同时验证重复点击、余额不足、任务过期、取消和并发认领等异常场景。

## 阶段 6：备份、监控与上线

- [ ] 在测试环境恢复一次数据库备份
- [ ] 验证误删数据后的恢复流程
- [ ] 验证数据库连接失败时后端降级提示
- [ ] 配置慢查询告警
- [ ] 配置连接数告警
- [ ] 配置存储空间告警
- [ ] 配置 CPU 和内存告警
- [ ] 开启操作审计
- [ ] 执行 SQL 注入、越权、重复扣款测试
- [ ] 执行压力测试
- [ ] 执行注册到结算的全链路测试
- [ ] 准备数据库迁移回滚脚本
- [ ] 准备生产发布和故障回滚步骤
- [ ] 生产环境只使用密钥管理中的连接信息
- [ ] 上线后观察错误率、慢查询、任务完成率和退款数量

## 关键风险与处理原则

### 1. 不要直接照搬单一余额字段

蛋蛋币至少需要区分可用余额和冻结余额，并通过事务和幂等键保护每次结算。

### 2. 不要让页面负责自动退款

自动退款必须由后端定时任务执行，页面只负责展示结果。

### 3. 不要把所有状态塞进一个字段

任务状态、认领状态、提交状态和结算状态需要分开建模，并由后端状态机约束合法转换。

### 4. 不要公开返回联系方式

联系方式只有在确认配对后，才允许配对双方通过受权限保护的接口读取。

### 5. 不要共用生产和测试账号

生产库、测试库和本地开发库必须隔离，连接串和账号密码也必须隔离。

## 推荐优先级

1. P0：腾讯云实例、VPC、白名单、备份和账号权限
2. P0：`users`、`auth_sessions`、`user_stats`、`user_characters`
3. P0：`point_accounts`、`point_transactions`
4. P0：注册、登录、个人资料 API
5. P1：前端数据层接入
6. P1：任务、认领、提交、验收和评价
7. P1：自动退款、通知和反馈
8. P2：排行榜、推荐、邀请风控和统计分析

## 最终上线标准

- 用户数据可持久化
- 蛋蛋币账目可追溯且不会重复结算
- 权限和隐私字段经过服务端控制
- 任务状态流转有明确约束
- 数据库备份和恢复已经实际演练
- 前端不再依赖关键内存变量作为事实来源
