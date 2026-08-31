# 我的任务卡片主题改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在“我的任务”页面统一四类任务的发布/认领卡片视觉，同时保留所有现有业务行为。

**Architecture:** 使用现有 `data-task-type` 与 `pub-*` 类型类作为主题选择器。两处渲染函数输出相同的语义化卡片结构，CSS 负责布局、状态角标、主题色和响应式，不新增 API 或状态逻辑。

**Tech Stack:** 原生 HTML、CSS、JavaScript、Vitest 前端契约测试。

## Global Constraints

- 只修改 `backend-handoff-package/growth-school.html` 的 CSS 和任务卡片 HTML 结构。
- 不修改 API、状态归一化、筛选器、弹窗、取消、提交、评价或认领业务逻辑。
- 保留现有 `onclick` 处理器、`data-task-*` 属性和 `escapeHtml()` 输入转义。
- 四类主题：teach `#5B5FEF`、team `#F08A24`、help `#0F9F92`、reward `#B7791F`。
- 桌面与移动宽度均不得出现文字溢出；尊重现有 reduced-motion 规则。

---

### Task 1: 建立统一任务卡片 CSS

**Files:**
- Modify: `backend-handoff-package/growth-school.html:1792-1804`（浅色主题任务卡片覆盖区）
- Test: `server/tests/task-plaza-ui-contract.test.ts`（仅运行现有契约）

**Interfaces:**
- Consumes: 卡片根节点的 `.card`、`pub-*`、`data-task-type`、`data-status-group` 类/属性。
- Produces: `.mytask-card`、`.mytask-card__meta`、`.mytask-card__title`、`.mytask-card__description`、`.mytask-card__actions` 等展示选择器。

- [ ] **Step 1: 添加主题变量和公共结构样式**

在浅色主题块中增加 `.mytask-card` 的圆角、白色主体、轻阴影、顶部主题色带、内部间距、标题换行、简介截断和操作区布局；使用 `pub-teach/pub-team/pub-help/pub-reward` 与 `data-task-type` 映射四种主题变量。

- [ ] **Step 2: 添加状态角标样式**

增加 `.mytask-status--pending`、`.mytask-status--approved`、`.mytask-status--completed`、`.mytask-status--revision`、`.mytask-status--cancelled` 五种颜色，并确保角标文字保持深色对比度。

- [ ] **Step 3: 添加移动端覆盖**

在现有 `@media (max-width:620px)` 中让卡片内边距、按钮组和 meta 行收缩，标题使用 `overflow-wrap:anywhere`，操作按钮允许换行。

- [ ] **Step 4: 运行现有 UI 契约测试**

Run: `cd server && npx vitest run tests/task-plaza-ui-contract.test.ts`

Expected: PASS；现有“查看详情”文本与卡片行为契约仍满足。

### Task 2: 重写发布任务卡片展示模板

**Files:**
- Modify: `backend-handoff-package/growth-school.html:5114-5144`

**Interfaces:**
- Consumes: `renderSyncedPublishedTask(task)` 的现有字段、状态分组和操作条件。
- Produces: 保留原卡片 `data-*` 属性和 `openSyncedTaskDetail`、`openClaimerManager`、`reviewMyTask`、`cancelPublishedTask` 处理器的新 HTML 结构。

- [ ] **Step 1: 保留根节点属性与状态计算**

继续设置 `data-task-id`、`data-status-group`、`data-task-type`、描述、联系方式和要求属性，根节点增加 `mytask-card pub-${type}` 类，不改变 `group` 与 `label` 计算。

- [ ] **Step 2: 输出统一信息层级**

将原内联 div 改为 meta 行、标题、简介、修改意见（有值时）、操作区；状态角标使用状态类，发布时间保留 `formatDateYmd(task.createdAt)`，标题和简介继续 `escapeHtml()`。

- [ ] **Step 3: 保留原有操作按钮及事件**

原条件下继续输出查看详情、认领管理、确认完成和取消任务按钮，事件字符串与参数保持不变。

### Task 3: 重写认领任务卡片展示模板

**Files:**
- Modify: `backend-handoff-package/growth-school.html:5145-5169`

**Interfaces:**
- Consumes: `renderSyncedClaimedTask(claim)` 的现有状态、联系方式、取消协商、评价和提交完成条件。
- Produces: 保留 `data-claim-id`、`data-claim-status` 等属性及 `openSyncedTaskDetail`、`submitClaimedTask`、`respondSyncedTaskCancellationRequest`、`openClaimerRating` 事件。

- [ ] **Step 1: 映射认领状态到状态类**

把 `claimLabel` 映射到统一的 pending/approved/completed/revision/cancelled 类，不改变原状态文案。

- [ ] **Step 2: 输出与发布卡片相同的结构**

使用同样的 meta、标题、简介、奖励信息、取消协商提示和操作区容器；奖励任务保留“完成奖励 N 蛋蛋币”标签。

- [ ] **Step 3: 保留条件操作**

原 `controls`、`completedRatingAction` 和取消申请操作原样保留，只调整外层布局 class。

### Task 4: 验证四类主题与响应式行为

**Files:**
- Modify: `backend-handoff-package/growth-school.html` only if verification finds a display regression.
- Test: `server/tests/frontend-ux-regressions.test.ts`, `server/tests/production-data-frontend-contract.test.ts`

- [ ] **Step 1: 静态检查四类主题选择器**

Run: `rg -n "pub-teach|pub-team|pub-help|pub-reward|data-task-type=\\\"(teach|team|help|reward)\\\"" backend-handoff-package/growth-school.html`

Expected: 四类均有主题变量和状态/操作结构选择器。

- [ ] **Step 2: 运行相关前端契约测试**

Run: `cd server && npx vitest run tests/task-plaza-ui-contract.test.ts tests/frontend-ux-regressions.test.ts tests/production-data-frontend-contract.test.ts`

Expected: 全部 PASS。

- [ ] **Step 3: 运行全量测试**

Run: `cd server && npx vitest run`

Expected: 全部测试通过，0 failed。

- [ ] **Step 4: 查看最终 diff 并提交**

Run: `git diff --check; git diff --stat; git status --short`

确认只包含本次 HTML 改动（以及已提交的设计/计划文档），再执行：

```bash
git add backend-handoff-package/growth-school.html docs/superpowers/specs/2026-08-31-task-card-theme-design.md docs/superpowers/plans/2026-08-31-task-card-theme-redesign.md
git commit -m "style: unify themed task cards across task categories"
```
