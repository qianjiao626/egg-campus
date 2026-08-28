# 大学吐槽榜接入设计

日期：2026-08-28
状态：已批准，待实现

## 目标

将附件中的“大学吐槽榜”模块接入当前主站，保留现有认证、任务、盲盒、打听、反馈、排行榜和实时能力。不替换附件旧版整页 Demo。

## 范围

- 访客可读取统计、极值、排名、搜索、吐槽墙和学校详情。
- 登录用户可提交一次学校吐槽；同一用户同一学校不可重复提交，不可编辑。
- 16 个指标沿用附件 key 与文案，评分为必填整数 `0-10`。
- 前两次提交各奖励 `10` 蛋蛋币和 `10` 经验，之后仍可提交但不奖励。
- 未收录学校可由用户新增，第一版直接进入 `approved`。
- 公开昵称脱敏为首字 + `**` + 末字；学校展示名加“蛋蛋世界的”。
- 管理员不需要审核页面，但保留管理员软删除公开记录的接口。
- 学校种子使用附件全量 `2361` 条，包含本科、专科和高职；不导入演示吐槽或演示评分。

## 方案

当前主页面增加 `page-blacklist` 和导航入口；大学榜逻辑放入独立 `blacklist.js`，样式限定在页面作用域。复用现有 `api-client.js`、`DandanAppState`、`realtime-client.js`、认证、限流和敏感词校验。

不采用整页替换或 iframe：前者会覆盖当前生产功能，后者会割裂登录态、样式和实时刷新。

## 数据模型

只新增三张表：

- `schools`：名称、状态、创建者和时间字段；省份、院校类型、985/211 等信息可空，第一版不展示或筛选。
- `school_comments`：用户对学校的一次吐槽、综合分、公开状态和时间；唯一约束 `(user_id, school_id)`。
- `school_scores`：每条吐槽的 16 项指标明细。

提交写入、综合分计算、奖励判断、积分/经验流水在同一事务内完成。暂不使用冗余 `school_stats` 或 Redis；统计和排名由 SQL 聚合。

## API

保持附件路径和字段契约：

- `GET /api/blacklist/stats`
- `GET /api/blacklist/extremes`
- `GET /api/blacklist/rank?metric=all&page=1&pageSize=20`
- `GET /api/blacklist/metric-rank?metric=...&pageSize=20`
- `GET /api/blacklist/search?keyword=...`
- `GET /api/blacklist/wall?page=1&pageSize=20`
- `GET /api/blacklist/school/:schoolId`
- `POST /api/blacklist/school/add`
- `POST /api/blacklist/submit`
- `GET /api/blacklist/my-count`

读取接口公开；提交、新增学校和次数查询要求登录。ID 统一返回字符串。分页最大 `50`；指标使用固定 allowlist；非法参数返回 `400`。

## 实时与错误处理

成功提交或管理员软删除后广播公共事件 `blacklist.updated`。前端收到事件后重新拉取当前视图，保留指标、页码、搜索词、滚动位置和正在填写的表单。详情打开时同步刷新。

WebSocket 断线时保留当前数据，恢复连接后同步；API 失败不回退演示数据，显示空状态/错误状态和重试入口。提交失败不改变本地积分、经验或表单内容。

## 测试与发布边界

测试覆盖公开读取、未登录提交 `401`、重复提交 `409`、奖励上限、并发唯一性、评分和文本校验、隐私输出、分页、实时事件及断线降级。

先在当前工作区完成迁移、实现和隔离测试；不自动上传 CVM、不执行生产迁移、不重启 PM2。
