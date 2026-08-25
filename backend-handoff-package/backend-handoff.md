# 蛋蛋世界 - 网页上线清单 & 后端交接文档

> 文档版本：v1.0 | 生成日期：2026-08-23  
> 项目目录：`C:\Users\19537\AppData\Roaming\TRAE SOLO CN\ModularData\ai-agent\work-mode-projects\6a81826bb30ebfa43e14e8ff\`

---

## 一、项目现状概览

| 项目 | 说明 |
|------|------|
| 主文件 | `growth-school.html`（约 628KB，单文件应用） |
| 技术架构 | 纯前端 HTML + 内联 CSS + 内联 JavaScript，无框架依赖 |
| 数据存储 | **无持久化**，全部为内存变量，刷新即丢失 |
| 后端 API | **无**，无任何 fetch/Ajax/HTTP 请求 |
| 外部依赖 | **无** CDN、无第三方库、无外部字体 |
| 图片资源 | ~40 张角色图片（jpg/png），均为本地文件 |
| 函数数量 | 约 230 个 JavaScript 函数 |

### 核心问题：当前是纯前端 Demo，上线必须对接后端

---

## 二、上线工作清单（按优先级排列）

### P0 - 必须完成（不上线会崩）

| # | 工作项 | 负责方 | 说明 |
|---|--------|--------|------|
| 1 | 服务器 & 域名 | 运维 | 购买服务器、域名备案、配置 HTTPS 证书 |
| 2 | 后端 API 搭建 | 后端 | 按本文档第四节实现所有 API 接口 |
| 3 | 数据库建表 | 后端 | 按本文档第三节建表，导入初始数据 |
| 4 | 前端数据层改造 | 前端 | 将所有内存变量改为 API 调用（见第五节） |
| 5 | 用户注册/登录 | 后端 | 当前的昵称登录需替换为真实认证（手机号/微信/学信网） |
| 6 | 图片资源托管 | 运维 | 角色图片上传至 CDN/OSS，替换前端本地路径 |
| 7 | 蛋蛋币系统 | 后端 | 实现积分的增删改查、冻结/释放、交易流水 |
| 8 | 任务状态机 | 后端 | 实现三种任务类型的完整状态流转（见第六节） |

### P1 - 强烈建议（影响核心体验）

| # | 工作项 | 负责方 | 说明 |
|---|--------|--------|------|
| 9 | 数据持久化 | 后端 | localStorage 兜底，防止刷新丢失 |
| 10 | 消息通知系统 | 后端 | 站内通知 + 可选微信/短信推送 |
| 11 | 评价系统 | 后端 | 双向评价、口碑值计算、防重复评价 |
| 12 | 自动退回定时任务 | 后端 | 3天/1个月无人认领的自动退款定时器 |
| 13 | 管理后台权限 | 后端 | 管理员审核任务、处理反馈工单 |
| 14 | 搜索 & 筛选 | 后端 | 任务广场的分类筛选改为服务端查询 |
| 15 | 文件上传 | 后端 | 用户头像、任务附件上传 |

### P2 - 建议完成（提升体验）

| # | 工作项 | 负责方 | 说明 |
|---|--------|--------|------|
| 16 | 移动端适配优化 | 前端 | 当前有基础响应式，需进一步测试优化 |
| 17 | 分享功能 | 前端 | 当前有 QQ/微博分享，需对接真实 URL |
| 18 | 数据统计 | 后端 | 用户增长、任务完成率、留存率等 |
| 19 | 安全加固 | 后端 | XSS 防护、CSRF、接口限流、输入校验 |
| 20 | 性能优化 | 前端 | HTML 文件过大(628KB)，考虑拆分 CSS/JS |

---

## 三、数据库表结构设计

### 3.1 用户表 `users`

```sql
CREATE TABLE users (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  nickname        VARCHAR(50) NOT NULL UNIQUE COMMENT '昵称',
  email           VARCHAR(100) COMMENT '邮箱',
  phone           VARCHAR(20) COMMENT '手机号',
  password_hash   VARCHAR(255) COMMENT '密码哈希',
  role            ENUM('student','admin') DEFAULT 'student',
  school          VARCHAR(100) COMMENT '学校',
  major           VARCHAR(100) COMMENT '专业',
  city            VARCHAR(50) COMMENT '城市',
  grade           VARCHAR(20) COMMENT '年级',
  age             INT COMMENT '年龄',
  bio             TEXT COMMENT '个人简介',
  mbti_type       VARCHAR(4) COMMENT 'MBTI类型',
  mbti_group      VARCHAR(2) COMMENT 'MBTI分组: NT/NF/SJ/SP',
  points          INT DEFAULT 100 COMMENT '蛋蛋币余额',
  exp             INT DEFAULT 0 COMMENT '经验值（完成任务数）',
  likes           INT DEFAULT 0 COMMENT '获赞数',
  reputation      DECIMAL(2,1) DEFAULT 0.0 COMMENT '口碑值（评价均分）',
  egg_category    VARCHAR(20) COMMENT '蛋类型分类',
  egg_rarity      ENUM('N','R','SR','SSR','UR') DEFAULT 'N',
  invite_code     VARCHAR(20) COMMENT '邀请码',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### 3.2 用户统计表 `user_stats`（五维属性）

```sql
CREATE TABLE user_stats (
  user_id        BIGINT PRIMARY KEY,
  knowledge      DECIMAL(2,1) DEFAULT 0 COMMENT '学识值 0-10',
  skills         DECIMAL(2,1) DEFAULT 0 COMMENT '打工值 0-10',
  charm          DECIMAL(2,1) DEFAULT 0 COMMENT '魅力值 0-10',
  money          DECIMAL(2,1) DEFAULT 0 COMMENT '搞钱值 0-10',
  reputation     DECIMAL(2,1) DEFAULT 0 COMMENT '口碑值 0-5',
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### 3.3 任务表 `tasks`

```sql
CREATE TABLE tasks (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  title           VARCHAR(200) NOT NULL COMMENT '任务标题',
  description     TEXT COMMENT '任务描述',
  task_type       ENUM('teach','help','team','reward') NOT NULL COMMENT '任务类型',
  skill_category  VARCHAR(50) COMMENT '技能大类',
  skill_sub       VARCHAR(50) COMMENT '技能子类',
  reward          INT DEFAULT 10 COMMENT '蛋蛋币金额',
  claim_mode      ENUM('single','multiple') DEFAULT 'single' COMMENT '认领模式',
  max_claimers    INT COMMENT '最大认领人数',
  requirements    TEXT COMMENT '参与要求',
  publisher_id    BIGINT NOT NULL COMMENT '发布者ID',
  contact         VARCHAR(200) COMMENT '发布者联系方式',
  status          ENUM('pending','approved','rejected','in_progress','completed','cancelled','expired') DEFAULT 'pending',
  signup_deadline DATETIME COMMENT '报名截止',
  complete_deadline DATETIME COMMENT '完成截止',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (publisher_id) REFERENCES users(id)
);
```

### 3.4 任务认领表 `task_claims`

```sql
CREATE TABLE task_claims (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  task_id         BIGINT NOT NULL,
  claimer_id      BIGINT NOT NULL COMMENT '认领者ID',
  status          ENUM('pending_pairing','in_progress','submitted','completed','rejected','cancelled') DEFAULT 'pending_pairing',
  claimer_contact VARCHAR(200) COMMENT '认领者联系方式',
  selected        BOOLEAN DEFAULT FALSE COMMENT '是否被发布者选中',
  paired_at       DATETIME COMMENT '配对确认时间',
  submitted_at    DATETIME COMMENT '提交完成时间',
  completed_at    DATETIME COMMENT '最终完成时间',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_task_claimer (task_id, claimer_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (claimer_id) REFERENCES users(id)
);
```

### 3.5 评价表 `ratings`

```sql
CREATE TABLE ratings (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  task_id      BIGINT NOT NULL,
  rater_id     BIGINT NOT NULL COMMENT '评价者ID',
  ratee_id     BIGINT NOT NULL COMMENT '被评价者ID',
  score        INT NOT NULL COMMENT '1-5星',
  comment      TEXT COMMENT '文字评价',
  rater_role   ENUM('publisher','claimer') NOT NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_rating (task_id, rater_id, ratee_id) COMMENT '防重复评价',
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

### 3.6 蛋蛋币流水表 `point_logs`

```sql
CREATE TABLE point_logs (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id      BIGINT NOT NULL,
  type         VARCHAR(50) NOT NULL COMMENT '类型: earn/spend/freeze/refund/reward',
  label        VARCHAR(200) COMMENT '描述',
  delta        INT NOT NULL COMMENT '变动金额（正增加负减少）',
  balance      INT COMMENT '变动后余额',
  task_id      BIGINT COMMENT '关联任务ID',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### 3.7 打听/八卦表 `gossip_posts`

```sql
CREATE TABLE gossip_posts (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  title        VARCHAR(200) NOT NULL,
  description  TEXT,
  publisher_id BIGINT NOT NULL,
  bounty       INT DEFAULT 1 COMMENT '悬赏蛋蛋币',
  coin_status  ENUM('frozen','awarded','refunded') DEFAULT 'frozen',
  adopted      BOOLEAN DEFAULT FALSE,
  adopted_answer_id BIGINT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  deadline     DATETIME COMMENT '30天后自动退回',
  is_permanent BOOLEAN DEFAULT TRUE COMMENT '提问永久保留',
  FOREIGN KEY (publisher_id) REFERENCES users(id)
);

CREATE TABLE gossip_answers (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  post_id      BIGINT NOT NULL,
  author_id    BIGINT NOT NULL,
  content      TEXT NOT NULL,
  likes        INT DEFAULT 0,
  is_adopted   BOOLEAN DEFAULT FALSE,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES gossip_posts(id),
  FOREIGN KEY (author_id) REFERENCES users(id)
);
```

### 3.8 通知表 `notifications`

```sql
CREATE TABLE notifications (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id      BIGINT NOT NULL,
  text         VARCHAR(500) NOT NULL,
  type         VARCHAR(30) DEFAULT 'info',
  is_read      BOOLEAN DEFAULT FALSE,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### 3.9 反馈工单表 `feedback_tickets`

```sql
CREATE TABLE feedback_tickets (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id      BIGINT,
  content      TEXT NOT NULL,
  contact      VARCHAR(200) COMMENT '联系方式（选填）',
  status       ENUM('open','replied','closed') DEFAULT 'open',
  admin_reply  TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### 3.10 角色解锁表 `user_characters`

```sql
CREATE TABLE user_characters (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id      BIGINT NOT NULL,
  category     VARCHAR(20) NOT NULL COMMENT 'study/job/side/hobby/game/life',
  unlocked     BOOLEAN DEFAULT FALSE,
  count        INT DEFAULT 0 COMMENT '该分类完成任务数',
  is_current   BOOLEAN DEFAULT FALSE COMMENT '是否当前使用',
  UNIQUE KEY uk_user_cat (user_id, category),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

---

## 四、API 接口清单

### 4.1 用户相关

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 用户注册（昵称+密码/手机号） |
| POST | `/api/auth/login` | 用户登录 |
| POST | `/api/auth/logout` | 退出登录 |
| GET | `/api/users/:id` | 获取用户信息 |
| PUT | `/api/users/:id` | 更新用户信息 |
| GET | `/api/users/:id/stats` | 获取五维属性 |
| GET | `/api/users/:id/characters` | 获取角色解锁状态 |
| GET | `/api/users/:id/point-logs` | 获取蛋蛋币流水 |
| GET | `/api/users/:id/notifications` | 获取通知列表 |
| PUT | `/api/users/:id/notifications/read` | 标记通知已读 |

### 4.2 任务相关

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tasks` | 获取任务列表（支持筛选：类型/分类/状态） |
| GET | `/api/tasks/:id` | 获取任务详情 |
| POST | `/api/tasks` | 发布任务 |
| PUT | `/api/tasks/:id` | 更新任务 |
| POST | `/api/tasks/:id/claim` | 认领/报名任务 |
| GET | `/api/tasks/:id/claimers` | 获取认领者列表 |
| POST | `/api/tasks/:id/pair` | 确认配对（发布者选择） |
| POST | `/api/tasks/:id/submit` | 认领者提交完成 |
| POST | `/api/tasks/:id/confirm` | 发布者确认完成 |
| POST | `/api/tasks/:id/cancel` | 取消任务（协商取消） |
| GET | `/api/tasks/my-published` | 我发布的任务 |
| GET | `/api/tasks/my-claimed` | 我认领的任务 |
| POST | `/api/tasks/:id/rate` | 提交评价 |

### 4.3 打听/八卦相关

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/gossip` | 获取打听列表 |
| GET | `/api/gossip/:id` | 获取打听详情 |
| POST | `/api/gossip` | 发布打听（扣冻结蛋蛋币） |
| POST | `/api/gossip/:id/answer` | 回答打听 |
| POST | `/api/gossip/:id/adopt` | 采纳回答（发放悬赏） |

### 4.4 管理后台

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/tasks/pending` | 待审核任务列表 |
| POST | `/api/admin/tasks/:id/approve` | 审核通过 |
| POST | `/api/admin/tasks/:id/reject` | 审核驳回 |
| GET | `/api/admin/users` | 用户管理列表 |
| GET | `/api/admin/feedback` | 反馈工单列表 |
| POST | `/api/admin/feedback/:id/reply` | 回复工单 |

### 4.5 排行榜

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/rankings/total` | 总榜（按经验值排名） |
| GET | `/api/rankings/coins` | 富豪榜（按蛋蛋币排名） |
| GET | `/api/rankings/:category` | 分类榜（按对应能力值排名） |

---

## 五、前端需要改造的变量对照表

当前内存变量 → 需要替换为 API 调用：

| 变量名 | 当前行号 | 数据说明 | 替换为 |
|--------|---------|---------|--------|
| `USER` | L2700 | 当前登录用户 | `GET /api/users/:id` |
| `USER_DB` | L3322 | 用户名片数据库 | `GET /api/users/:id`（按需查询） |
| `TASK_CLAIMERS` | L3307 | 任务认领者映射 | `GET /api/tasks/:id/claimers` |
| `GOSSIP_POSTS` | L4049 | 打听/八卦帖子列表 | `GET /api/gossip` |
| `CHAR_STATE` | L2775 | 角色解锁状态 | `GET /api/users/:id/characters` |
| `PUBLISHER_RATINGS` | L3838 | 已评价记录 | 依赖 `ratings` 表唯一约束 |
| `pointLogs` | L3189 | 蛋蛋币流水 | `GET /api/users/:id/point-logs` |
| `FEEDBACK_TICKETS` | L3831 | 反馈工单 | `GET /api/admin/feedback` |
| `REGISTERED_USERS` | L2735 | 已注册用户表 | 后端用户表 |
| `notifications` | L3214 | 通知列表 | `GET /api/users/:id/notifications` |

---

## 六、核心业务规则（后端必须实现）

### 6.1 蛋蛋币流转规则

| 任务类型 | 蛋蛋币方向 | 时机 | 说明 |
|---------|-----------|------|------|
| 教学型 teach | 认领者 → 发布者 | 认领者提交完成时 | 认领者支付，发布者收取 |
| 求助型 help | 发布者 → 认领者 | 发布者确认完成时 | 发布者悬赏，完成者获得 |
| 组队型 team | 发布者 → 认领者 | 双方确认完成后 | 发布者冻结，确认后释放 |
| 打听 gossip | 发布者冻结 → 回答者 | 采纳回答时 | 冻结1个月，采纳发放，无人回答自动退回 |

### 6.2 任务状态机

```
教学型: pending(待审核) → approved(已通过) → pending_pairing(待确认配对) → in_progress(进行中) → submitted(已提交) → completed(已完成)
求助型: pending → approved → pending_pairing → in_progress → submitted → completed
组队型: pending → approved → pending_pairing → in_progress → confirmer_confirmed(搭子已确认) → completed(双方确认)
```

### 6.3 关键约束

| 规则 | 说明 |
|------|------|
| 不能认领自己的任务 | 发布者无法认领自己发布的任务 |
| 求助型超额报名 | 不受名额限制，发布者选择帮办 |
| 组队型限制报名 | 报名人数不能超过发布时设置的最大人数 |
| 教学型48小时取消 | 发布后48小时内可协商取消，超过需客服介入 |
| 求助/组队3天无人认领 | 自动退回冻结蛋蛋币 |
| 打听1个月无人回答 | 自动退回冻结蛋蛋币，提问永久保留 |
| 评价不可重复 | 同一任务同一对评价者→被评价者只能评一次 |
| 联系方式可见性 | 仅在确认配对后（进行中/已提交状态）显示 |
| 蛋蛋币不足不可发布 | 发布任务时校验余额是否足够 |
| 经验值 = 任务完成数 | 与获赞数独立，经验值决定等级和稀有度 |

### 6.4 等级 & 稀有度

| 等级 | 经验值范围 | 名称 |
|------|-----------|------|
| 1 | 0-99 | 新手蛋 |
| 2 | 100-299 | 进阶蛋 |
| 3 | 300-599 | 达人蛋 |
| 4 | 600-999 | 大神蛋 |
| 5 | 1000+ | 传奇蛋 |

| 稀有度 | 完成任务数 | 颜色 |
|--------|-----------|------|
| N | 0+ | #C0C0C0 |
| R | 5+ | #4A90D9 |
| SR | 15+ | #9B59B6 |
| SSR | 30+ | #FFD700 |
| UR | 50+ | #FF6B6B |

### 6.5 技能分类（6大类）

| 分类 | 字段值 | 图标 | 颜色 |
|------|--------|------|------|
| 学业技术 | study | 📖 | #E91E63 |
| 就业技能 | job | 💼 | #2196F3 |
| 副业技能 | side | 💰 | #FFD700 |
| 兴趣爱好 | hobby | 🎯 | #9C27B0 |
| 游戏搭子 | game | 🎮 | #4CAF50 |
| 生活互助 | life | 🤝 | #FF6B6B |

---

## 七、静态资源清单

### 7.1 需要上传到 CDN/OSS 的图片文件

以下图片均在项目根目录，需上传至 CDN 并替换 HTML 中的本地路径：

| 文件名 | 大小 | 用途 |
|--------|------|------|
| `char-eggy-study-v2.jpg` | 164KB | 学业技术角色 |
| `char-eggy-job-v2.jpg` | 164KB | 就业技能角色 |
| `char-eggy-side.jpg` | 234KB | 副业技能角色 |
| `char-eggy-hobby-v2.jpg` | 212KB | 兴趣爱好角色 |
| `char-eggy-game.jpg` | 185KB | 游戏搭子角色 |
| `char-eggy-life-v2.jpg` | 181KB | 生活互助角色 |
| `char-eggy-hermit.jpg` | 298KB | 隐士蛋（管理员角色） |
| `logo-char.png` | 6KB | Logo图片（如需保留） |
| `char-eggy-study.jpg` | 160KB | 学业技术角色（旧版） |
| `char-eggy-job.jpg` | 180KB | 就业技能角色（旧版） |
| `char-eggy-hobby.jpg` | 154KB | 兴趣爱好角色（旧版） |
| `char-eggy-life.jpg` | 162KB | 生活互助角色（旧版） |
| `char-eggy-preview.html` | 3KB | 角色预览页（开发用，不上线） |

### 7.2 不需要上线的开发文件

| 文件/目录 | 说明 |
|-----------|------|
| `character-generator.html` | 角色生成器（开发工具） |
| `char-system.html` | 角色系统预览（开发工具） |
| `char-preview*.html` | 角色预览页（开发工具） |
| `filter-test.html` | 筛选测试页（开发工具） |
| `nav-test.html` | 导航测试页（开发工具） |
| `competitive-analysis.html` | 竞品分析（文档） |
| `launch-checklist.html` | 旧版上线清单（已废弃） |
| `schema-fixed.sql` | 旧版SQL（已废弃，以本文档为准） |
| `create_analysis.ps1` | 分析脚本（开发工具） |
| `陪跑大学生分析表.*` | 分析数据（参考文档） |
| `prd-content.xml` | PRD原始内容（参考文档） |
| `growth-school-task-flows.md` | 任务流程分析（参考文档） |
| `cross-border-workbench-plan/` | 跨境工作台方案（其他项目） |
| `growth-school-prd/` | PRD文档目录 |
| `dandan-prd/` | PRD HTML版本 |
| `product-audit-report/` | 产品审计报告 |
| `product-supply-chain-teaching/` | 供应链教学（其他项目） |
| `.trae-html-share-packages/` | 分享包（开发工具） |

---

## 八、前端代码结构说明

### 8.1 页面结构

| 页面ID | 模块名 | 说明 |
|--------|--------|------|
| `page-plaza` | 技能变现 | 教学型任务广场 |
| `page-teamplaza` | 组队共创 | 组队型任务广场 |
| `page-helpplaza` | 求助中心 | 求助型任务广场 |
| `page-rankhall` | 神蛋榜单 | 排行榜 |
| `page-gossip` | 八卦吃瓜 | 打听/问答 |
| `page-mytasks` | 我的任务 | 已发布+已认领任务 |
| `page-publish` | 发布任务 | 任务发布表单 |
| `page-profile` | 我的信息 | 个人信息页 |
| `page-dashboard` | 管理后台 | 管理员工作台 |
| `page-users` | 用户管理 | 管理员管理用户 |
| `page-feedback` | 反馈管理 | 管理员处理工单 |

### 8.2 角色权限

| 角色 | 可见页面 |
|------|---------|
| student | plaza, teamplaza, helpplaza, rankhall, gossip, mytasks, publish, profile |
| admin | dashboard, taskgroups, newgroup, reviewcenter, submissions, review, users, feedback, states |

### 8.3 核心配置常量

```javascript
CANCEL_TIME_LIMIT_HOURS = 48;   // 教学型任务取消时限（小时）
AUTO_REFUND_DAYS = 3;           // 组队/求助无人认领自动退回（天）
GOSSIP_REFUND_DAYS = 30;        // 打听无人回答自动退回（天）
```

---

## 九、给后端同事的交接文件清单

以下文件需要打包转交后端团队：

| # | 文件 | 用途 | 路径 |
|---|------|------|------|
| 1 | `growth-school.html` | 完整前端代码 | 项目根目录 |
| 2 | `backend-handoff.md` | 本交接文档 | 项目根目录 |
| 3 | `growth-school-task-flows.md` | 任务流程详细分析 | 项目根目录 |
| 4 | `char-eggy-*.jpg`（7张） | 核心角色图片 | 项目根目录 |
| 5 | `logo-char.png` | Logo图片 | 项目根目录 |
| 6 | `schema-fixed.sql` | 旧版SQL参考（已被本文档第三节替代） | 项目根目录 |

---

## 十、上线部署步骤

```
1. 后端按第三节建表，按第四节实现API
2. 前端按第五节改造数据层（内存变量 → API调用）
3. 图片资源上传CDN，替换HTML中的本地路径
4. 配置服务器 Nginx/Apache，部署 growth-school.html
5. 配置 HTTPS 证书
6. 配置域名解析
7. 跑通完整流程测试：注册 → 发布 → 认领 → 配对 → 完成 → 评价
8. 压力测试 & 安全扫描
9. 正式上线
```

---

*文档结束。如有疑问请参考 `growth-school.html` 源码或联系前端开发者。*
