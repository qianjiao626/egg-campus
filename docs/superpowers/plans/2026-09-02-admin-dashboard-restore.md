# Admin Dashboard Restore Implementation Plan

> **For agentic workers:** Execute each task with a focused test checkpoint.

**Goal:** Restore the previously approved administrator analytics dashboard on the current main branch without regressing certification or team-rating behavior.

**Architecture:** Add the existing `AnalyticsEvent` Prisma model and authenticated event/stats endpoints. Restore the six ECharts panels and date/type filters in the existing `page-dashboard`, using the current `api-client.js` request wrapper and admin permission checks.

**Tech Stack:** Fastify, Prisma/MySQL, TypeScript, vanilla HTML/JavaScript, ECharts 5.5.1, Vitest.

## Global Constraints

- Preserve current authentication, permissions, certification, team-rating, refund, and task flows.
- No DROP/DELETE operations and no unrelated formatting.
- Analytics write failures must never break the business request that produced them.

### Task 1: Restore analytics data contract

**Files:** `server/prisma/schema.prisma`, `server/prisma/migrations/202609020002_admin_analytics/migration.sql`, `server/src/app.ts`

- Add `AnalyticsEvent` relation/model mapped to `analytics_events` with the three existing indexes and nullable user foreign key.
- Add authenticated `POST /api/analytics/event` for `page_view`, `nav_click`, and `active_op`.
- Add permission-gated `GET /api/admin/dashboard/stats?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` returning daily registrations, page views, UV, homepage views, DAU, nav clicks, task publish/claim totals and per-type series.
- Keep analytics writes best-effort.

### Task 2: Restore client and dashboard UI

**Files:** `backend-handoff-package/api-client.js`, `backend-handoff-package/growth-school.html`

- Restore `trackEvent`, `adminDashboardStats`, and `adminUserDetail` client methods.
- Restore ECharts CDN loading, six chart containers, date range controls, publish/claim type filters, chart initialization/rendering, resize handling, and page-view/nav-click hooks in the existing dashboard.
- Render empty datasets as valid zero-valued charts and keep all user-provided labels escaped.

### Task 3: Verify and release

**Files:** `server/tests/admin-dashboard-certification.test.ts`, `docs/releases/2026-08-29-production-r3.json`

- Restore contract tests for analytics endpoint/model and six chart regions.
- Run `cd server && npx vitest run`, `npm run build`, `git diff --check`, and release-boundary verification.
- Update release hashes, commit only named dashboard files, push `main`, back up production DB, reconcile/apply the analytics table migration, deploy backend/frontend, and verify health, dashboard assets, PM2 status, and logs.
