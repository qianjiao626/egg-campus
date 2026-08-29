# Hide Shop Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide all shop UI for every role while retaining the complete shop implementation for later reactivation.

**Architecture:** A root HTML data attribute is the single feature switch. CSS prevents shop UI from rendering while the SPA router and role hydration code enforce the same switch at runtime.

**Tech Stack:** Static HTML, CSS, vanilla JavaScript, Vitest contract tests, Nginx static hosting.

## Global Constraints

- Preserve all shop DOM, JavaScript, API client, backend, RBAC, Prisma, migration, and test code.
- Do not deploy shop backend changes or run shop database migrations.
- Deploy only the changed static frontend file with the specified SSH disk key.

---

### Task 1: Lock the hidden-shop contract

**Files:**
- Modify: `server/tests/shop-frontend-contract.test.ts`
- Modify: `backend-handoff-package/growth-school.html`

**Interfaces:**
- Consumes: existing `go(id)` router and role hydration handler.
- Produces: `SHOP_FRONTEND_ENABLED`, `SHOP_PAGE_IDS`, `data-shop-ui`, and root `data-shop-enabled` switch.

- [ ] Add contract assertions for the default-off root switch, all seven marked navigation entries, all seven marked page sections, and router enforcement.
- [ ] Run `npm test -- --run tests/shop-frontend-contract.test.ts` from `server` and confirm the new assertions fail.
- [ ] Add the minimal root switch, CSS visibility rule, UI markers, router guard, and role-hydration guard.
- [ ] Re-run the focused contract test and confirm it passes.
- [ ] Run the frontend-related contract tests and TypeScript build.

### Task 2: Deploy and verify

**Files:**
- Upload: `backend-handoff-package/growth-school.html` to the active `/dd` static root discovered from Nginx.
- Update locally: `docs/obsidian-sync/06-变更日志.md`

**Interfaces:**
- Consumes: the existing Tencent CVM Nginx site and SSH key.
- Produces: a production page with shop UI disabled and all non-shop functionality retained.

- [ ] Verify the disk key exists and connect using `ssh -i` with agent forwarding disabled.
- [ ] Read the active Nginx configuration and resolve the exact `/dd` static path.
- [ ] Back up the remote HTML, then upload only the changed HTML with `scp -i`.
- [ ] Run `nginx -t`, reload Nginx only if configuration is valid, and request `/dd/`, `/dd/health`, and `/dd/growth-school.html`.
- [ ] Download or query the live HTML and confirm the switch is off, shop UI is marked, and non-shop navigation remains present.
- [ ] Record the deployment and verification results in the Obsidian change log.

