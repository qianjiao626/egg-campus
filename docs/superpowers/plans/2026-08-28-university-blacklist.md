# University Blacklist Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the attachment's public university blacklist to the existing Dandan Campus site without replacing the current application.

**Architecture:** Add three Prisma models and a full 2,361-school seed asset. Expose public read routes and authenticated mutation routes under `/api/blacklist/*`; keep reward and uniqueness decisions inside transactions. Add a scoped page and `blacklist.js` to the current static frontend, reusing the existing API client, authentication state, WebSocket hub, content filter, and UI conventions.

**Tech Stack:** Fastify 5, Prisma 6/MySQL, TypeScript, Vitest, existing static HTML/CSS/JavaScript frontend, existing WebSocket realtime client.

## Global Constraints

- Preserve current authentication, task, blind-box, inquiry, feedback, leaderboard, shop-disabled, and realtime behavior.
- Use the attachment's complete `BL_SCHOOLS` list: 2,361 unique names including undergraduate, vocational, and junior-college schools.
- Do not import attachment demo comments, demo scores, or demo users.
- Public reads require no login; submit, add-school, and my-count require login.
- Sixteen fixed metrics; every score is a required integer from 0 through 10.
- One immutable comment per `(user_id, school_id)`; first two user submissions earn 10 points and 10 experience each.
- Public names are masked; school display names use the `蛋蛋世界的` prefix.
- No blacklist admin page in v1; provide an admin-only soft-delete mutation.
- No production deployment, remote migration, PM2 restart, or CVM upload in this implementation.

---

### Task 1: Import and validate the full school seed

**Files:**
- Create: `server/prisma/seed/blacklist-schools.json`
- Create: `server/tests/blacklist-seed.test.ts`
- Create: `server/src/blacklist.ts`

**Interfaces:**
- `BLACKLIST_METRICS`: readonly array of the 16 `{ key, name, description }` metric definitions.
- `BLACKLIST_METRIC_KEYS`: readonly allowlist of metric keys.
- `normalizeBlacklistSchoolName(value: string): string` trims and collapses whitespace.
- `maskBlacklistNickname(value: string | null | undefined): string` returns the public masked nickname.
- `displayBlacklistSchoolName(value: string): string` prefixes the raw name exactly once.

- [ ] **Step 1: Write the failing seed and helper tests**

```ts
it('contains all attachment schools without duplicates', () => {
  expect(schools).toHaveLength(2361);
  expect(new Set(schools)).toHaveSize(2361);
  expect(schools).toContain('清华大学');
  expect(schools).toContain('深圳职业技术大学');
});

it('keeps the sixteen metric keys stable', () => {
  expect(BLACKLIST_METRIC_KEYS).toHaveLength(16);
  expect(BLACKLIST_METRIC_KEYS).toContain('headcount');
});

it('masks public nicknames and prefixes schools once', () => {
  expect(maskBlacklistNickname('海景蛋')).toBe('海**蛋');
  expect(maskBlacklistNickname('川蛋')).toBe('川*');
  expect(displayBlacklistSchoolName('清华大学')).toBe('蛋蛋世界的清华大学');
  expect(displayBlacklistSchoolName('蛋蛋世界的清华大学')).toBe('蛋蛋世界的清华大学');
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `cd server; npm test -- blacklist-seed.test.ts --maxWorkers=1`
Expected: FAIL because the seed file and blacklist helpers do not exist.

- [ ] **Step 3: Extract the attachment array into JSON and add helpers**

Use the already extracted attachment HTML as the source, parse the `BL_SCHOOLS` array, normalize and deduplicate names, assert the result is exactly 2,361, and write JSON. Define the metric constants and pure masking/name helpers in `server/src/blacklist.ts`.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd server; npm test -- blacklist-seed.test.ts --maxWorkers=1`
Expected: PASS with 2,361 schools and 16 metrics.

- [ ] **Step 5: Commit**

```bash
git add server/prisma/seed/blacklist-schools.json server/tests/blacklist-seed.test.ts server/src/blacklist.ts
git commit -m "feat: add blacklist school seed and rules"
```

### Task 2: Add Prisma models and migration

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/202608280001_blacklist/migration.sql`
- Create: `server/tests/blacklist-schema-contract.test.ts`

**Interfaces:**
- `BlacklistSchool` maps to `schools`.
- `BlacklistComment` maps to `school_comments`.
- `BlacklistScore` maps to `school_scores`.
- `BlacklistComment.status` uses `approved` and `deleted` values.

- [ ] **Step 1: Write the failing schema contract**

```ts
it('declares the three blacklist models and uniqueness constraints', () => {
  expect(schema).toContain('model BlacklistSchool');
  expect(schema).toContain('model BlacklistComment');
  expect(schema).toContain('model BlacklistScore');
  expect(schema).toContain('@@unique([userId, schoolId])');
  expect(schema).toContain('@@unique([commentId, metricKey])');
});
```

- [ ] **Step 2: Run the contract and verify it fails**

Run: `cd server; npm test -- blacklist-schema-contract.test.ts --maxWorkers=1`
Expected: FAIL because the models are absent.

- [ ] **Step 3: Add models and migration**

Add indexed foreign-key models with raw school/comment text limits, public status, creator IDs, timestamps, and the two uniqueness constraints. Generate a MySQL migration containing the same tables, foreign keys, indexes, and constraints. Add relations to `User`.

- [ ] **Step 4: Generate Prisma and run the contract**

Run: `cd server; npm run prisma:generate; npm test -- blacklist-schema-contract.test.ts --maxWorkers=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/202608280001_blacklist/migration.sql server/tests/blacklist-schema-contract.test.ts
git commit -m "feat: add blacklist persistence schema"
```

### Task 3: Seed schools and implement public read services

**Files:**
- Create: `server/src/scripts/seed-blacklist-schools.ts`
- Modify: `server/package.json`
- Modify: `server/src/blacklist.ts`
- Create: `server/tests/blacklist-read-contract.test.ts`

**Interfaces:**
- `seed-blacklist-schools.ts` upserts the JSON names and never creates comments.
- `serializeBlacklistSchool` returns raw `schoolId` as a string plus public display name.
- `rankBlacklistSchools(metric, page, pageSize)` excludes zero-comment schools and applies score/count/name ordering.

- [ ] **Step 1: Write failing read and seed tests**

Cover public route status `200`, page-size cap at 50, `metric` allowlist, zero-comment exclusion, tie ordering, masked wall users, and seed idempotence with no comment writes.

- [ ] **Step 2: Run and verify red**

Run: `cd server; npm test -- blacklist-read-contract.test.ts --maxWorkers=1`
Expected: FAIL because routes and seed command are absent.

- [ ] **Step 3: Implement pure read serializers, SQL aggregation, and seed command**

Use public Fastify routes without `preHandler`. Aggregate score averages from approved comments and scores; return `stats`, `extremes`, `rank`, `metric-rank`, `search`, `wall`, and school detail with string IDs and masked names. Enforce `pageSize <= 50`, keyword length `1-50`, and fixed metric keys.

- [ ] **Step 4: Run focused tests**

Run: `cd server; npm test -- blacklist-read-contract.test.ts --maxWorkers=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/blacklist.ts server/src/scripts/seed-blacklist-schools.ts server/package.json server/tests/blacklist-read-contract.test.ts
git commit -m "feat: add blacklist public reads"
```

### Task 4: Add authenticated submit and school creation transactions

**Files:**
- Modify: `server/src/app.ts`
- Modify: `server/src/blacklist.ts`
- Create: `server/tests/blacklist-submit-contract.test.ts`

**Interfaces:**
- `POST /api/blacklist/school/add` returns `{ success, schoolId, schoolName, displayName }`.
- `POST /api/blacklist/submit` accepts `{ schoolId?, schoolName?, scores: Record<MetricKey, number>, comment?: string }`.
- `GET /api/blacklist/my-count` returns `{ totalCount, rewardedCount, remainingReward }`.

- [ ] **Step 1: Write failing transaction tests**

Cover guest `401`, all scores required, `0-10` integer validation, blocked text rejection, automatic school creation, duplicate `409`, first two rewards, third no reward, and transaction rollback on failure.

- [ ] **Step 2: Run and verify red**

Run: `cd server; npm test -- blacklist-submit-contract.test.ts --maxWorkers=1`
Expected: FAIL because mutation routes are absent.

- [ ] **Step 3: Implement minimal mutation routes**

Require `app.authenticate`; normalize school names; resolve or create the school; lock/check the user's submission count; create one comment and 16 score rows; calculate the average in the server; award points and experience only while `rewardedCount < 2`; write the existing point transaction/idempotency records; catch Prisma unique violations as `409`.

- [ ] **Step 4: Run focused tests and full backend tests**

Run: `cd server; npm test -- blacklist-submit-contract.test.ts --maxWorkers=1`
Expected: PASS.

Run: `cd server; npm test -- --maxWorkers=1`
Expected: Existing suite and blacklist tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/app.ts server/src/blacklist.ts server/tests/blacklist-submit-contract.test.ts
git commit -m "feat: add blacklist submissions and rewards"
```

### Task 5: Add admin soft delete and realtime publication

**Files:**
- Modify: `server/src/app.ts`
- Create: `server/tests/blacklist-realtime-contract.test.ts`

**Interfaces:**
- `PATCH /api/admin/blacklist/comments/:id` accepts `{ status: 'deleted' }` and requires an administrative permission.
- Successful submit or soft delete calls `realtime.publishPublic(realtimeEvent('blacklist.updated', resourceId, 'public'))`.

- [ ] **Step 1: Write failing authorization and event tests**

Cover student `403`, authorized admin soft deletion, public exclusion of deleted comments, submit event, and delete event.

- [ ] **Step 2: Run and verify red**

Run: `cd server; npm test -- blacklist-realtime-contract.test.ts --maxWorkers=1`
Expected: FAIL because the route and event do not exist.

- [ ] **Step 3: Implement permission and event handling**

Add a dedicated permission key to the existing RBAC definitions, use the existing permission helper, update status only (never hard-delete), and publish the public event after commit.

- [ ] **Step 4: Run focused tests**

Run: `cd server; npm test -- blacklist-realtime-contract.test.ts --maxWorkers=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/app.ts server/src/permissions.ts server/tests/blacklist-realtime-contract.test.ts
git commit -m "feat: add blacklist moderation event"
```

### Task 6: Add API client and page shell

**Files:**
- Modify: `backend-handoff-package/api-client.js`
- Modify: `backend-handoff-package/growth-school.html`
- Create: `server/tests/blacklist-frontend-contract.test.ts`

**Interfaces:**
- `apiClient.blacklistStats()`, `blacklistExtremes()`, `blacklistRank(query)`, `blacklistMetricRank(query)`, `blacklistSearch(keyword)`, `blacklistWall(query)`, `blacklistSchool(id)`, `addBlacklistSchool(payload)`, `submitBlacklist(payload)`, `blacklistMyCount()`.
- Page ID: `blacklist`; nav label: `大学吐槽榜`; root: `page-blacklist`.

- [ ] **Step 1: Write failing frontend contract tests**

Assert all client methods, guest-visible nav/page, submit-login gating, `blacklist.js` script inclusion, and absence of attachment demo data.

- [ ] **Step 2: Run and verify red**

Run: `cd server; npm test -- blacklist-frontend-contract.test.ts --maxWorkers=1`
Expected: FAIL because the client methods and page shell are absent.

- [ ] **Step 3: Add scoped page and client methods**

Add only the page markup and nav item to the existing HTML. Keep it visible to guests and use existing page routing. Implement client methods through the shared `request` helper; do not add direct `fetch` calls in the page.

- [ ] **Step 4: Run focused frontend contract**

Run: `cd server; npm test -- blacklist-frontend-contract.test.ts --maxWorkers=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend-handoff-package/api-client.js backend-handoff-package/growth-school.html server/tests/blacklist-frontend-contract.test.ts
git commit -m "feat: add blacklist page shell and client"
```

### Task 7: Implement frontend rendering and realtime behavior

**Files:**
- Create: `backend-handoff-package/blacklist.js`
- Modify: `backend-handoff-package/growth-school.html`
- Modify: `server/tests/blacklist-frontend-contract.test.ts`

**Interfaces:**
- `window.DandanBlacklist.load()` loads stats, extremes, current ranking, and wall.
- `window.DandanBlacklist.refreshCurrentView()` preserves metric, page, search, and form state.
- Realtime subscription listens for `blacklist.updated` and calls `refreshCurrentView()`.

- [ ] **Step 1: Extend failing frontend tests**

Assert 16 sliders, public error/empty states, login gating, no demo fallback, form preservation on failed submit, and subscription to `blacklist.updated`.

- [ ] **Step 2: Run and verify red**

Run: `cd server; npm test -- blacklist-frontend-contract.test.ts --maxWorkers=1`
Expected: FAIL because rendering and realtime code are absent.

- [ ] **Step 3: Implement minimal page controller**

Use existing `escapeHtml`, toast, modal, auth state, and page lifecycle. Render the four stats, extreme cards, tabs, paginated rankings, wall, search dropdown, school detail, and submit modal. Keep styles under `#page-blacklist`; submit errors leave inputs intact. Use the existing realtime subscription cleanup hook.

- [ ] **Step 4: Run focused and browser smoke checks**

Run: `cd server; npm test -- blacklist-frontend-contract.test.ts --maxWorkers=1`
Expected: PASS.

Run the existing local frontend smoke flow with a guest and authenticated test account; verify guest read access, login prompt, submission refresh, and event-triggered refresh.

- [ ] **Step 5: Commit**

```bash
git add backend-handoff-package/blacklist.js backend-handoff-package/growth-school.html server/tests/blacklist-frontend-contract.test.ts
git commit -m "feat: render blacklist and live updates"
```

### Task 8: Final verification and handoff

**Files:**
- Modify: `docs/obsidian-sync/04-验证记录.md` only if the verification record is requested after tests.

- [ ] **Step 1: Run static checks**

Run: `cd server; npm run build`
Expected: exit code 0.

Run: `git diff --check`
Expected: no output.

- [ ] **Step 2: Run the full test suite**

Run: `cd server; npm test -- --maxWorkers=1`
Expected: all tests pass, including blacklist contracts.

- [ ] **Step 3: Validate seed count and migration status**

Run the seed validation test and inspect the generated migration; confirm 2,361 names, no demo comments, and no uncommitted generated artifacts.

- [ ] **Step 4: Review scope**

Confirm `git diff --stat` contains only the planned blacklist files, the existing main page/client, schema/migration, tests, and optional seed command. Do not deploy.

- [ ] **Step 5: Commit verification record if changed**

```bash
git add docs/obsidian-sync/04-验证记录.md
git commit -m "docs: record blacklist verification"
```
