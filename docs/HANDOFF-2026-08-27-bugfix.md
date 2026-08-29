# HANDOFF：全站走查 Bug 清单与修复计划

- 来源：`docs/online-test-reports/2026-08-27-browser-full-walkthrough.md`（31 项用例，4 浏览器会话模拟 3 学生 + 1 管理员）
- 生成时间：2026-08-27
- 涉及环境：隔离测试服务（测试库 `dandan_campus_test`，隧道 13311→3311）；生产仅只读健康检查
- 交接目标：让下一个会话可以直接按本清单修 Bug，不重复排查

## 1. 一句话结论

后端业务链路（任务结算、悬赏转移、互评、邀请奖励、盲盒、打听）全部验证正确；**前端存在 2 个阻断核心任务闭环的 Bug（BUG-2/BUG-3）**，以及 2 个高优（BUG-1/BUG-4）、3 个中低优（BUG-5/BUG-6/BUG-7），建议按 P0 → P1 → P2 顺序修复后回归。

## 2. Bug 总览

| 编号 | 严重度 | 模块 | 一句话 | 主要位置 |
| --- | --- | --- | --- | --- |
| BUG-1 | 高 | 通知/评价 | 铃铛面板永远空白；「我的评价」明细列表空白 | `growth-school.html:3310` `:3641` |
| BUG-2 | 阻断 | API 客户端 | 9 个无 body 的 POST 全部 400，提交完成/取消任务等不可用 | `api-client.js:18-24` 及 9 个方法 |
| BUG-3 | 阻断 | 我的任务 | 发布者无「确认完成/认领管理」UI 入口（死代码） | `growth-school.html:5829` `:5306` |
| BUG-4 | 高 | 八卦吃瓜 | 标签点击无反应；发布打听按钮无响应 | `growth-school.html:7177-7230` |
| BUG-5 | 高 | 会话 | 并发刷新令牌竞态，偶发导致会话永久失效 | `api-client.js:231-233` |
| BUG-6 | 中 | 邀请 | 邀请记录字段错位，显示「? undefined undefined」 | `growth-school.html:3504-3537` |
| BUG-7 | 中 | RBAC | 撤销角色授权 500 | `server/src/app.ts:652-665` / `shop-maintenance.ts:15` |

## 3. Bug 详情与修复计划

### BUG-1　铃铛面板空白 / 评价明细空白（高）

- 现象：通知铃铛永远「暂无通知」；个人中心「我的评价」平均分正常但明细列表空白。
- 根因：`formatFbTime` 未定义，`syncNotifications()`（`growth-school.html:3310`）与评价渲染（`growth-school.html:3641`）调用时抛 `ReferenceError`。全仓 grep 仅 2 处引用、0 处定义；API 数据本身正常。
- 修复方案（前端单文件）：
  - 在脚本工具区（如 `notificationText` 附近）新增：
    ```js
    function formatFbTime(ts){
      var diff = Date.now() - ts;
      if(diff < 60000) return '刚刚';
      if(diff < 3600000) return Math.floor(diff/60000) + ' 分钟前';
      if(diff < 86400000) return Math.floor(diff/3600000) + ' 小时前';
      var d = new Date(ts);
      return (d.getMonth()+1) + '.' + d.getDate();
    }
    ```
- 验收：铃铛面板展示通知列表（含已读/未读）；个人中心评价明细正常显示。

### BUG-2　无 body 的 POST 全部 400（阻断）

- 现象：认领人点「提交完成」报「请求格式不正确」；发布者「取消任务」同样失败。
- 根因：`api-client.js` 的 `request()`（L18-24）无条件设置 `Content-Type: application/json`，而 `submitTask`/`adoptInquiry`/`likeInquiry`/`likeInquiryReply`/`refundExpiredInquiries`/`markNotificationRead`/`markAllNotificationsRead`/`abandonTask`/`cancelTask` 共 9 个方法 POST 无 body → Fastify `FST_ERR_CTP_EMPTY_JSON_BODY`(400)。
- 实证：`submitTask('35')`、`cancelTask('33')` 均 400 `INVALID_JSON`；同接口带 `{}` 请求体返回 200（后端正常）。
- 修复方案（推荐，api-client.js 一处改动）：
  ```js
  var headers = Object.assign({}, options.headers || {});
  if (options.body != null) headers['Content-Type'] = 'application/json';
  ```
  - 兜底：或给 9 个无 body 方法显式传 `body: '{}'`（改动面大，不推荐）。
- 验收：提交完成、取消任务、采纳打听、点赞、标记已读等按钮全部可正常操作。

### BUG-3　发布者确认/认领管理入口缺失（阻断）

- 现象：认领人提交后，发布者在「我的任务」看不到任何确认入口，任务无法 UI 结算。
- 根因：`reviewMyTask`（L5829，含「确认完成并评价」逻辑）与 `openClaimerManager`（L5306）无任何 onclick 引用，属死代码。
- 修复方案（前端单文件）：
  - 在 `renderSyncedPublishedTask`（约 L4660）中，对「已审核」状态任务卡追加按钮：
    ```js
    '<button class="btn btn-primary btn-sm" onclick="reviewMyTask(this)">确认完成</button>'
    ```
  - `reviewMyTask` 已实现：内部调 `apiClient.taskClaims(taskId)` 拉取认领，仅 submitted 状态显示「确认完成并评价」（`confirmReviewAndRate` → `completeTask` → `openRating`）。
- 验收：认领人提交后，发布者可在「我的任务」看到认领列表并确认完成，走通结算+互评。

### BUG-4　`selectedGossipTag` 未声明（高）

- 现象：八卦页点标签无高亮；点「发布打听」无响应。
- 根因：`selectedGossipTag` 从未声明，`toggleGossipTag`（L7177）与 `publishGossip`（L7209）读取时抛 `ReferenceError: selectedGossipTag is not defined`。
- 修复方案（前端单文件，一行）：
  - 在 L5024 `var publishTaskType = 'teach';` 附近补：`var selectedGossipTag = null;`
- 验收：标签可点选高亮；发布打听成功（悬赏冻结、1 个月未答自动退回提示正常）。

### BUG-5　刷新令牌轮换竞态（高）

- 现象：多请求并发触发 401 时各自独立 refresh，令牌轮换竞态导致部分 refresh 401，此后会话永久失效，用户被强制重登。
- 根因：`api-client.js` `request()` 内 `401 && !retry` 分支（L51）直接 `await apiClient.refresh()`，无并发去重；实测 8 并发出现 6×200 + 2×401。
- 修复方案（api-client.js）：
  - 增加单飞锁：模块级 `var refreshPromise = null;`，`refresh` 入口改为：
    ```js
    refresh: async function () {
      if (!refreshPromise) {
        refreshPromise = (async function(){ /* 原 refresh 逻辑 */ })()
          .finally(function(){ refreshPromise = null; });
      }
      return refreshPromise;
    }
    ```
  - refresh 失败时清空 accessToken/refreshToken 并重置锁。
- 验收：多标签页/并发请求场景连续操作不出现 401 风暴；会话保持稳定。

### BUG-6　邀请记录字段错位（中）

- 现象：邀请记录显示「? undefined undefined 待发布任务」。
- 根因：后端 `/api/users/me/invitations`（`server/src/app.ts:2954-2970`）返回 `invitedUser.nickname`、`status: 'rewarded' | 'pending_first_approved_task'`、`reward: 20|0`；前端 `growth-school.html:3504-3537` 读 `i.nickname`、`i.status === 'done'`。
- 修复方案（前端单文件，两处）：
  - L3504-3505：`i.status === 'done'` → `i.status === 'rewarded'`（pending 用 `'pending_first_approved_task'` 或非 rewarded 兜底）；
  - L3531-3537：`i.nickname` → `i.invitedUser.nickname`，`i.status === 'done'` → `i.status === 'rewarded'`。
- 验收：邀请记录显示被邀请人昵称、「已完成 +20 / 待发布任务」与正确奖励状态。

### BUG-7　撤销角色授权 500（中）

- 现象：给用户授予角色成功；撤销授权时接口 500。
- 根因：`server/src/app.ts:652-665` 撤销事务内调用 `offSalePublisherProductsIfUnauthorized`（`server/src/shop-maintenance.ts:15`），其 `db.shopProduct.updateMany` 查询 `shop_products` 表（测试库无此表）→ Prisma P2021。走查日志已确认。
- 修复方案（后端）：
  - 在 `shop-maintenance.ts` 的 `offSalePublisherProductsIfUnauthorized` 内，将 `db.shopProduct.updateMany` 用 try/catch 包裹，捕获 P2021（表不存在）等降级返回 0，不影响授权撤销事务；
  - 或调用处（app.ts L665）在商城未启用配置下跳过下架维护。
  - 注意红线：**保持商城关闭，不引入商城迁移**；修复仅保证关闭状态下的健壮性。
  - 改后需构建 dist 并重启 `dandan-world-test`（部署标准见 `docs/交接文档-2026-08-27.md` 第 6 节）。
- 验收：撤销授权返回成功，授权/撤销审计记录正常。

## 4. 修复顺序与回归

- P0（阻断闭环，先修）：BUG-2 → BUG-3。
- P1：BUG-1、BUG-4、BUG-5。
- P2：BUG-6、BUG-7。
- 回归用例（对应走查报告）：
  1. 教学/求助/组队任务：发布→审核→认领→**UI 提交完成**→**发布者确认完成**→互评→余额/经验正确；
  2. 取消任务/协商取消正常；
  3. 八卦：标签点选 + 发布打听 + 回答采纳 + 打赏；
  4. 铃铛通知与「我的评价」明细展示；
  5. 邀请记录展示正确；
  6. 管理端授予/撤销角色授权；
  7. 多标签页并发操作后会话不失效。

## 5. 红线与注意事项

- 测试数据：走查在测试库留下 `[demo]` 数据（用户 56/57/58、任务 32-35、认领/评价/盲盒/打听/反馈），如需干净环境可重置测试库（与生产无关）。
- 本文档不包含任何口令/令牌；如需凭据见 `docs/交接文档-2026-08-27.md`。
- 生产环境只读；前端修复按「只更新前端静态文件」流程（hash 校验 + 原子覆盖 + Nginx reload）上线。
- 商城维持 `data-shop-enabled="false"` 与后端关闭状态，不暴露入口、不执行迁移。