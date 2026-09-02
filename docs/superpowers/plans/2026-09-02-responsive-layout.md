# Responsive Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with checkpoints.

**Goal:** Make the main campus site and standalone blind-box page usable at desktop, tablet, and phone widths without changing business logic.

**Architecture:** Keep the existing HTML and JavaScript contracts. Add a small, explicit responsive override layer to the main page and refine the blind-box stylesheet's existing breakpoints. Use fluid grid tracks, local overflow containers, viewport-bounded dialogs, and touch-sized controls instead of scaling the whole page on narrow screens.

**Tech Stack:** Static HTML/CSS, existing inline styles, `backend-handoff-package/blind-box/styles.css`, Vitest contract tests, Playwright browser checks.

## Global Constraints

- Do not change API calls, business logic, event handlers, or data contracts.
- Desktop layout must remain visually and behaviorally compatible.
- No page-level horizontal scrolling; only tables/long option rows may scroll locally.
- Main interactive controls must retain at least 44px touch height on phone layouts.
- Keep `:focus-visible` and `prefers-reduced-motion` behavior intact.
- Preserve existing colors, typography, and visual language; only adjust responsive sizing and placement.

### Task 1: Stabilize Main Page Responsive Shell

**Files:**
- Modify: `backend-handoff-package/growth-school.html` in the responsive CSS block near `#stage`, `.app`, `.main`, `.page`.
- Test: `server/tests/frontend-responsive-contract.test.ts` (create).

**Interfaces:**
- Consumes: Existing `#stage`, `.sidebar`, `.main`, `.page`, `.topbar` markup.
- Produces: Breakpoint rules that expose a fluid page width, natural document height, and a single vertical scroll owner on narrow screens.

- [ ] **Step 1: Write the failing contract test**

  Assert that the main page contains responsive rules for `min-width:0`, `overflow-x:hidden`, a tablet breakpoint, a phone breakpoint, and viewport-bounded page height.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `cd server && npx vitest run tests/frontend-responsive-contract.test.ts`
  Expected: FAIL because the new responsive markers are not present.

- [ ] **Step 3: Add the shell overrides**

  Add a final responsive override block that:
  - keeps `#stage` fluid below 1100px instead of relying on transform scaling;
  - sets `.app`, `.main`, and all direct flex/grid children to `min-width:0`;
  - enables `overflow-x:hidden` on `html, body, #stage, .app` and vertical scrolling on `.main`/`.page` at narrow widths;
  - makes `.topbar` wrap with `min-width:0` and safe-area padding;
  - reduces sidebar width at tablet size and switches to icon-only navigation at phone size;
  - preserves the desktop rules above 1100px.

- [ ] **Step 4: Run the focused test and verify it passes**

  Run: `cd server && npx vitest run tests/frontend-responsive-contract.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit the shell change**

  ```bash
  git add backend-handoff-package/growth-school.html server/tests/frontend-responsive-contract.test.ts
  git commit -m "style: make main layout fluid on narrow screens"
  ```

### Task 2: Adapt Main Page Content, Tables, and Dialogs

**Files:**
- Modify: `backend-handoff-package/growth-school.html` responsive CSS block.
- Test: `server/tests/frontend-responsive-contract.test.ts`.

**Interfaces:**
- Consumes: Task 1 shell breakpoints and existing page/component selectors.
- Produces: Responsive grids, task cards, filters, tables, forms, modals, notification drawer, and admin dashboard charts.

- [ ] **Step 1: Extend the contract test with selector assertions**

  Assert responsive rules cover `.grid-3`, `.grid-2`, `.kpi-row`, `.table`, `.task-detail-card`, `.modal-overlay`, `.notif-panel`, `.dash-chart-row`, and `.dash-chart-card`.

- [ ] **Step 2: Run the focused test and verify the new assertions fail**

  Run: `cd server && npx vitest run tests/frontend-responsive-contract.test.ts`
  Expected: FAIL for selectors without narrow-screen rules.

- [ ] **Step 3: Add content-level responsive overrides**

  At tablet and phone widths:
  - collapse KPI/task/admin grids with `minmax(0,1fr)` tracks;
  - allow `.table` to scroll locally and prevent cell content from expanding the page;
  - wrap filter/tool rows and make search/input controls fluid;
  - set task/detail/profile/feedback/shop modals to `width:min(calc(100vw - 24px), var(--desktop-width))`, `max-height:calc(100dvh - 24px)`, and internal scrolling;
  - make notification panels and drawers viewport-bounded, with bottom-sheet behavior on phones;
  - keep dashboard charts readable by using one column below 900px and a shorter chart height below 600px;
  - set primary controls to `min-height:44px` on phones and add safe-area bottom padding.

- [ ] **Step 4: Run focused tests and inspect CSS diff**

  Run: `cd server && npx vitest run tests/frontend-responsive-contract.test.ts && git diff --check`
  Expected: PASS with no whitespace errors.

- [ ] **Step 5: Commit the content change**

  ```bash
  git add backend-handoff-package/growth-school.html server/tests/frontend-responsive-contract.test.ts
  git commit -m "style: fit main content, tables, and dialogs across viewports"
  ```

### Task 3: Finish Blind-Box Tablet and Phone Adaptation

**Files:**
- Modify: `backend-handoff-package/blind-box/styles.css`.
- Test: `server/tests/frontend-responsive-contract.test.ts`.

**Interfaces:**
- Consumes: Existing blind-box `.workspace`, `.buddy-stage`, `.match-grid`, `.feature-grid`, modal, and drawer selectors.
- Produces: Viewport-safe blind-box layouts with no page overflow and usable touch controls.

- [ ] **Step 1: Extend the contract test for blind-box rules**

  Assert the stylesheet contains tablet and phone rules for `.workspace`, `.match-grid`, `.feature-grid`, `.feature-modal`, `.message-drawer`, and `.open-box`.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `cd server && npx vitest run tests/frontend-responsive-contract.test.ts`
  Expected: FAIL until the new explicit safeguards are added.

- [ ] **Step 3: Add the blind-box safeguards**

  Append a narrow-screen override layer that:
  - sets `html, body, .buddy-content` to `max-width:100%` and `overflow-x:hidden`;
  - uses `minmax(0,1fr)` for workspace columns and keeps the stage before preferences on tablets;
  - ensures match/feature cards collapse to two columns then one column;
  - bounds decorative stage objects with `max-width` and `overflow:hidden`;
  - makes modals use `max-height:calc(100dvh - 24px)` and scrollable bodies;
  - keeps message drawer actions visible above safe-area padding;
  - applies 44px minimum heights to primary buttons and choice controls on phones.

- [ ] **Step 4: Run focused tests and diff check**

  Run: `cd server && npx vitest run tests/frontend-responsive-contract.test.ts && git diff --check`
  Expected: PASS.

- [ ] **Step 5: Commit the blind-box change**

  ```bash
  git add backend-handoff-package/blind-box/styles.css server/tests/frontend-responsive-contract.test.ts
  git commit -m "style: adapt blind-box layout for tablet and phone"
  ```

### Task 4: Browser Verification at All Target Sizes

**Files:**
- Test only: existing static pages served from `backend-handoff-package`.

**Interfaces:**
- Consumes: Tasks 1-3 responsive rules.
- Produces: Screenshot and DOM evidence for desktop, tablet, and phone layouts.

- [ ] **Step 1: Start a local static server**

  Run: `npx serve backend-handoff-package -l 4174`

- [ ] **Step 2: Inspect target viewports with Playwright**

  Check `growth-school.html` and `blind-box/index.html` at `1440x900`, `1024x768`, `768x1024`, `390x844`, and `360x800`.

- [ ] **Step 3: Verify layout invariants**

  For each page/viewport, assert `document.documentElement.scrollWidth <= window.innerWidth`, visible primary navigation, no clipped dialog actions, and no text nodes extending beyond their nearest card/container.

- [ ] **Step 4: Capture evidence and stop the server**

  Save screenshots under a temporary ignored output directory, review them, then stop the server without adding artifacts to Git.

### Task 5: Full Regression and Release Check

**Files:**
- Modify: `docs/releases/2026-08-29-production-r3.json` only if the final frontend hashes changed and the release process requires it.

- [ ] **Step 1: Run all checks**

  ```bash
  cd server
  npx vitest run
  npm run build
  node scripts/verify-release-boundary.mjs --production ../docs/releases/2026-08-29-production-r3.json
  git diff --check
  ```

- [ ] **Step 2: Review the final diff**

  Confirm only responsive CSS, the focused contract test, and required manifest hashes changed. Do not alter JS, backend behavior, or unrelated untracked files.

- [ ] **Step 3: Commit the release change**

  ```bash
  git add backend-handoff-package/growth-school.html backend-handoff-package/blind-box/styles.css server/tests/frontend-responsive-contract.test.ts docs/releases/2026-08-29-production-r3.json
  git commit -m "style: add responsive layouts for desktop tablet and phone"
  ```
