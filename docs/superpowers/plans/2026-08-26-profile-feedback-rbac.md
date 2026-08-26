# 蛋蛋校园资料、任务中心、反馈与 RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留现有用户和业务数据的前提下，完成个人资料二次编辑、任务中心整合、打听错误修复、反馈时间线与附件，以及可限时、可审计、立即生效的细粒度 RBAC。

**Architecture:** JWT 继续只证明身份与会话；新建 `authorization.ts` 从 Prisma 读取有效角色并构建 CASL Ability，所有管理路由使用稳定权限键而不是 JWT `role`。资料、反馈和上传的纯校验分别进入小模块，`app.ts` 只负责路由编排；前端继续使用现有单页和 `api-client.js`，通过服务端返回的能力列表决定可见入口，但服务端始终再次鉴权。

**Tech Stack:** TypeScript, Fastify 5, Prisma 6, MySQL/MariaDB, Zod, Vitest, `@casl/ability`, `@casl/prisma`, `@fastify/multipart`, compatible `file-type`, 原生 HTML/CSS/JavaScript。

## Global Constraints

- 只增量修改 `dandan_world`，不访问或改动“航线”项目及 Supabase。
- 保留 `User.role` 与手机号历史字段用于兼容，但授权服务不信任它们；短信 provider 保持关闭。
- 两个固定管理员永久受保护，公开统一显示“管理员”；临时密码不写入代码、迁移、Git、日志或文档。
- 密码首次初始化通过部署时隐藏输入完成，首次登录必须改密并撤销其他会话。
- 用户可见响应不暴露 `Route GET`、Prisma、SQL、堆栈或磁盘路径。
- 反馈附件只允许 JPG/PNG/WebP，单张 5 MiB、每次最多 3 张，存入非公开目录并经鉴权 API 读取。
- 所有手工代码变更使用测试先行；每个阶段先跑聚焦测试，再跑全量测试与构建。
- 当前工作树已有用户未提交的认证改动，不能回退、覆盖或混入无关提交。

---

## File Map

- Modify: `server/prisma/schema.prisma` - RBAC、资料冷却、强制改密、反馈时间线、附件和资源已读模型。
- Create: `server/prisma/migrations/202608260006_profile_feedback_rbac/migration.sql` - 只增不删的 MySQL 迁移与旧反馈状态映射。
- Create: `server/src/permissions.ts` - 稳定权限键、中文说明、风险等级和预置角色定义。
- Create: `server/src/authorization.ts` - 有效授权查询、CASL Ability、权限守卫和固定管理员保护。
- Create: `server/src/profile.ts` - 资料输入 schema、昵称冷却、MBTI/兴趣/技能规范化。
- Create: `server/src/feedback.ts` - 反馈状态机、重开窗口、消息和附件纯规则。
- Create: `server/src/protected-files.ts` - 安全文件名、magic number 校验、非公开文件读写。
- Modify: `server/src/config.ts` - 私密附件根目录和上传限制配置。
- Modify: `server/src/app.ts` - 注册新路由并逐步替换 `requireAdmin`。
- Modify: `backend-handoff-package/api-client.js` - 新资料、任务中心、反馈和 RBAC API。
- Modify: `backend-handoff-package/growth-school.html` - 资料编辑、四标签任务中心、反馈时间线、权限管理与管理员显示。
- Create: `server/tests/authorization.test.ts` - 多角色、期限、撤销、固定管理员保护。
- Create: `server/tests/profile-update.test.ts` - 资料更新、昵称冷却和盲盒同步。
- Create: `server/tests/feedback-timeline.test.ts` - 状态机、归属、重开和附件。
- Modify: `server/tests/business-contract.test.ts` - 打听发布到“我的打听”的回归测试。
- Modify: `server/tests/frontend-auth-contract.test.ts` - 默认首页、管理模式切换和 UI 契约。
- Modify: `docs/obsidian-sync/09-资料反馈与权限重构.md` - 每阶段状态和经验。

### Task 1: Add dependencies, schema, and additive migration

**Files:**
- Modify: `server/package.json`
- Modify: `server/package-lock.json`
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/202608260006_profile_feedback_rbac/migration.sql`

**Interfaces:**
- Produces Prisma models `Role`, `Permission`, `RolePermission`, `UserRoleGrant`, `RoleGrantAudit`, `FeedbackMessage`, `FeedbackAttachment`, and `ResourceReadState`.
- Adds `User.nicknameChangedAt`, `User.mustChangePassword`, `User.protectedAdminKey`, `User.interests`, and `User.skills` without deleting existing columns.

- [ ] **Step 1: Install pinned compatible dependencies**

Run in `server`:

```powershell
npm install @casl/ability @casl/prisma @fastify/multipart file-type
```

Inspect the lockfile and ensure Prisma remains on major version 6.

- [ ] **Step 2: Add schema contract checks before schema changes**

Create assertions in `server/tests/authorization.test.ts` that import the future permission catalog and fail because `permissions.ts` does not exist. Keep database behavior mocked; no production database is required.

- [ ] **Step 3: Add models and indexes**

Use `BigInt` IDs and snake_case mappings consistent with the existing schema. `UserRoleGrant` must prevent duplicate active relationships through application logic and provide indexes on `(userId, revokedAt, startsAt, expiresAt)` and `(roleId, revokedAt)`. Keep append-only grant audit rows.

- [ ] **Step 4: Write the additive migration**

The migration must create new tables/columns, map `open -> pending`, `processing -> processing`, `resolved/closed -> resolved`, and convert non-empty legacy `admin_remark` values into initial administrator `FeedbackMessage` rows without dropping `admin_remark`.

- [ ] **Step 5: Validate generated client and migration**

Run:

```powershell
npm run prisma:generate
npx prisma validate
npm run build
```

Expected: all commands exit 0 and no migration contains `DROP TABLE` or `DROP COLUMN`.

### Task 2: Build the permission catalog and authorization service

**Files:**
- Create: `server/src/permissions.ts`
- Create: `server/src/authorization.ts`
- Test: `server/tests/authorization.test.ts`

**Interfaces:**
- `PERMISSIONS` maps stable keys to `{ resource, action, description, risk }`.
- `loadAuthorizationContext(prisma, userId, now)` returns `{ ability, permissionKeys, isProtectedAdmin, grants }`.
- `requirePermission(context, key)` throws a stable `AuthorizationError('FORBIDDEN')`.
- `assertProtectedAdminMutationAllowed(actor, target, mutation)` blocks delete, suspend, nickname change and grant changes for protected administrators.

- [ ] **Step 1: Write failing pure tests**

Cover one active grant, multiple-role union, future grants, expired grants, revoked grants, disabled roles, permanent grants, and protected-admin mutations.

- [ ] **Step 2: Define the stable catalog**

Include every key from the approved spec plus the商城 keys in `2026-08-26-egg-mall-design.md`. Mark permission-management keys as protected and never assign them to non-fixed accounts.

- [ ] **Step 3: Implement effective grant filtering**

Use only server `now`; a grant is effective when `startsAt <= now`, `revokedAt` is null, the role is enabled, and `expiresAt` is null or greater than `now`.

- [ ] **Step 4: Build CASL Ability and scoped conditions**

Map catalog actions/resources into CASL rules. Ownership checks remain explicit conditions such as `{ userId }` or `{ publisherId: userId }`; unknown actions default to deny.

- [ ] **Step 5: Run tests**

```powershell
npm test -- authorization.test.ts
```

Expected: every effective/ineffective grant and fixed-admin protection test passes.

### Task 3: Integrate RBAC, fixed administrators, and forced password change

**Files:**
- Modify: `server/src/app.ts`
- Create: `server/tests/rbac-contract.test.ts`
- Modify: `server/tests/auth-session-flow.test.ts`

**Interfaces:**
- `request.authorization` is loaded after session authentication.
- `POST /api/auth/change-required-password` changes the password and revokes all other sessions.
- `/api/admin/roles`, `/api/admin/role-grants`, and `/api/admin/role-grant-audit` implement role CRUD, grant lifecycle and audit reads.

- [ ] **Step 1: Add failing route tests**

Assert JWT `role=admin` without an effective grant receives 403, an effective grant succeeds, revocation affects the next request, and a forced-change user can only change password or logout.

- [ ] **Step 2: Replace `requireAdmin` at each route**

Replace broad checks with exact keys such as `task.review`, `feedback.view`, `feedback.reply`, `feedback.status.update`, `points.adjust`, and `audit.view`. Ownership alternatives must remain explicit.

- [ ] **Step 3: Add idempotent RBAC seed logic**

Seed stable permissions and protected full-access role by code, not migration passwords. Resolve the two protected accounts by `protectedAdminKey`; deployment supplies password hashes separately through hidden input.

- [ ] **Step 4: Add grant management safeguards**

Allow 1 hour, 7 days, 1 month, 1 quarter, permanent and custom 1 hour to 1 year. Regranting the same role updates the existing effective grant and appends audit; protected permission-management keys cannot be delegated.

- [ ] **Step 5: Run focused tests**

```powershell
npm test -- rbac-contract.test.ts auth-session-flow.test.ts authorization.test.ts
```

### Task 4: Complete profile editing and blind-box profile sharing

**Files:**
- Create: `server/src/profile.ts`
- Modify: `server/src/app.ts`
- Create: `server/tests/profile-update.test.ts`

**Interfaces:**
- `profileUpdateSchema` accepts nickname, optional email, school, major, grade, city, age, bio, MBTI, interests, and skills; phone is excluded.
- `PUT /api/users/me` returns the updated normalized profile.
- Buddy preference reads use `User.mbtiType`, `User.interests`, and `User.skills` as canonical profile data while retaining blind-box-only fields.

- [ ] **Step 1: Write failing tests**

Cover nickname 30-day cooldown, fixed nickname lock, unique nickname/email errors, email verification reset, age bounds, tag deduplication, sensitive text rejection and atomic buddy-profile sync.

- [ ] **Step 2: Implement pure normalization**

Trim strings, uppercase valid MBTI values, deduplicate interests/skills, cap each list and item length, and never accept phone through this endpoint.

- [ ] **Step 3: Implement transactional update**

Lock/read the current user, enforce cooldown, update `nicknameChangedAt` only when nickname changes, clear `verifiedEmailAt` only when email changes, and write an audit record with sensitive fields excluded.

- [ ] **Step 4: Run focused tests**

```powershell
npm test -- profile-update.test.ts buddy-box-contract.test.ts
```

### Task 5: Consolidate My Tasks and fix inquiry refresh errors

**Files:**
- Modify: `server/src/app.ts`
- Modify: `server/tests/business-contract.test.ts`
- Modify: `backend-handoff-package/api-client.js`
- Modify: `backend-handoff-package/growth-school.html`

**Interfaces:**
- The existing `/api/inquiries/mine` remains canonical.
- `GET/PUT /api/read-states/:resourceType/:resourceId` records per-resource reads.
- The UI exposes tabs `published`, `claimed`, `inquiries`, and `feedback`, defaulting to `published`.

- [ ] **Step 1: Write the publish-to-mine integration test**

Create an inquiry, request `/api/inquiries/mine`, and assert the created record is returned without any response containing `Route GET`, stack, SQL, Prisma or file paths.

- [ ] **Step 2: Add read-state storage and counts**

Compute unread counts per resource; entering a tab does not clear counts, opening a specific record does.

- [ ] **Step 3: Update API client and navigation**

Ensure all requests use the existing request helper and `/api/inquiries/mine`; remove standalone sidebar entries but preserve old page IDs as redirects to the matching task tab.

- [ ] **Step 4: Preserve publish success**

After a successful publish, switch to `inquiries`, render the created item immediately, then refresh. A refresh failure shows a secondary Chinese retry message without replacing the success state.

- [ ] **Step 5: Run tests and syntax checks**

```powershell
npm test -- business-contract.test.ts
node --check ..\backend-handoff-package\api-client.js
```

### Task 6: Implement feedback timeline, transitions, and reopen rules

**Files:**
- Create: `server/src/feedback.ts`
- Modify: `server/src/app.ts`
- Create: `server/tests/feedback-timeline.test.ts`

**Interfaces:**
- Status values are `pending`, `processing`, `needs_changes`, `resolved`, and `rejected`.
- `POST /api/feedback/:id/messages` allows owner additions only in `needs_changes` and administrator replies with `feedback.reply`.
- `POST /api/feedback/:id/reopen` allows the owner once within 7 days of closure.

- [ ] **Step 1: Write failing state-machine tests**

Cover every allowed and denied transition, immutable original content, owner-only reads, needs-changes additions, one-time reopen and the exact seven-day boundary.

- [ ] **Step 2: Implement state and timeline helpers**

Keep messages append-only. Status changes and messages happen in one transaction with notification and audit rows.

- [ ] **Step 3: Replace legacy update semantics**

Keep old endpoints only as compatibility adapters that append a message and transition state; never overwrite `content` or delete history.

- [ ] **Step 4: Run tests**

```powershell
npm test -- feedback-timeline.test.ts business-contract.test.ts
```

### Task 7: Add protected feedback attachments

**Files:**
- Create: `server/src/protected-files.ts`
- Modify: `server/src/config.ts`
- Modify: `server/src/app.ts`
- Modify: `server/tests/feedback-timeline.test.ts`

**Interfaces:**
- `POST /api/feedback/:id/attachments` streams at most three files.
- `GET /api/feedback/:id/attachments/:attachmentId` authorizes owner or `feedback.attachment.view`.
- `POST /api/admin/feedback/:id/attachments/:attachmentId/hide` requires `feedback.attachment.hide`.

- [ ] **Step 1: Write failing multipart tests**

Reject unsupported extension, declared MIME mismatch, invalid magic number, over 5 MiB, fourth file, traversal names and cross-user reads; accept valid JPG/PNG/WebP.

- [ ] **Step 2: Implement non-public storage**

Generate a random storage key, keep the original name only as metadata, store outside `/var/www/dd`, and clean temporary files on all errors.

- [ ] **Step 3: Implement authenticated reads**

Return accurate `Content-Type`, `X-Content-Type-Options: nosniff`, controlled `Content-Disposition`, and no disk path. Hidden files return the user-facing hidden marker.

- [ ] **Step 4: Run tests**

```powershell
npm test -- feedback-timeline.test.ts
```

### Task 8: Build profile, feedback, RBAC, and administrator UI

**Files:**
- Modify: `backend-handoff-package/api-client.js`
- Modify: `backend-handoff-package/growth-school.html`
- Modify: `server/tests/frontend-auth-contract.test.ts`

**Interfaces:**
- Profile page has an edit icon/button and one modal.
- Administrator sidebar adds “用户与权限” with user grants, role management and audit tabs.
- UI mode switch changes presentation only; the server-provided ability remains authoritative.

- [ ] **Step 1: Add stable UI contract assertions**

Assert profile edit controls, four task tabs, feedback timeline controls, permission checkboxes with inline explanations, duration options including permanent/custom, admin mode switch and `prefers-reduced-motion` rules.

- [ ] **Step 2: Implement default landing by identity**

Logged-out users see login; users with effective management permissions default to admin mode; authenticated ordinary users default to normal mode. Persist mode only for the current session.

- [ ] **Step 3: Implement administrator presentation**

Public copy says only “管理员”. Add a small icon, distinct border and restrained sheen animation; never expose internal role names. Remove presentation immediately after permission expiry or a 403 refresh.

- [ ] **Step 4: Implement permission editor**

Group checkboxes by resource/action, put explanations after options, mark high-risk choices, show role impact before disable, and include durations 1 hour/7 days/1 month/1 quarter/permanent/custom.

- [ ] **Step 5: Implement feedback UI**

Render immutable original feedback, chronological messages, allowed status actions, needs-changes composer, attachment previews and reopen availability without showing raw backend errors.

- [ ] **Step 6: Run frontend checks**

```powershell
npm test -- frontend-auth-contract.test.ts
node --check ..\backend-handoff-package\api-client.js
```

Use Playwright at desktop and mobile sizes to verify no overlap, no component-local scrollbar, and working task/profile/feedback/permission flows.

### Task 9: Full verification, seed runbook, and Obsidian update

**Files:**
- Modify: `server/README.md`
- Create: `server/docs/rbac-seed-runbook.md`
- Modify: `docs/obsidian-sync/04-验证记录.md`
- Modify: `docs/obsidian-sync/05-执行待办.md`
- Modify: `docs/obsidian-sync/06-变更日志.md`
- Modify: `docs/obsidian-sync/09-资料反馈与权限重构.md`

**Interfaces:**
- Runbook accepts protected-admin passwords only through hidden terminal input or environment injected outside Git.
- Verification records exact commands and pass/fail counts without secrets.

- [ ] **Step 1: Run complete local verification**

```powershell
npm run prisma:generate
npx prisma validate
npm run build
npm test
node --check ..\backend-handoff-package\api-client.js
git diff --check
```

- [ ] **Step 2: Inspect migration and secret safety**

Confirm no destructive SQL, plaintext passwords, tokens, connection strings, protected attachment paths or temporary upload files are staged.

- [ ] **Step 3: Update operational docs**

Record backup-before-migrate, hidden credential bootstrap, RBAC seed idempotency, attachment directory ownership, rollback and health/log/public smoke gates. PM2 `online` alone is not success.

- [ ] **Step 4: Reconcile商城 integration**

Notify the商城 task that shared `authorization.ts`, Prisma RBAC models and permission keys are stable; then permit its schema/API integration under the file handoff in `docs/obsidian-sync/11-蛋蛋商城协作基线.md`.

## Self-Review Checklist

- [ ] Every approved profile, task-center, inquiry, RBAC, fixed-admin, feedback and attachment rule maps to a task.
- [ ] `User.role`, JWT role and frontend visibility are never treated as final authorization.
- [ ] No task writes or repeats either temporary administrator password.
- [ ] The migration is additive and preserves legacy feedback, users, phone fields and all relations.
- [ ] 商城 role/permission integration uses the same RBAC models and cannot create a parallel grant table.
- [ ] Full verification includes tests, TypeScript, Prisma, frontend syntax, migration inspection and UI smoke checks.
