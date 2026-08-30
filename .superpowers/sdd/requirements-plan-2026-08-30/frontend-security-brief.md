# Frontend security task brief

Implement P0-3, P0-4, P0-5, P1-3, P1-4 and P3-3 from `docs/requirements-plan-2026-08-30.md`.

Files in scope: `backend-handoff-package/growth-school.html`, its rollback-real-data copy if active, `blacklist.js`, `blind-box/buddy-box-api.js`, `blind-box/app.js`, `api-client.js`, and any minimal shared client helper needed. Do not change backend behavior or perform unrelated refactors.

Requirements:
- Escape every leaderboard/gossip nickname interpolation with the existing `escapeHtml`.
- Harden `escapeInlineString` for HTML attribute context, escaping `&` first, then quotes/angle brackets as needed; replace weaker hand-written escaping sites.
- Determine whether rollback-real-data.html is active. If active, mirror fixes; if clearly inactive, leave deletion decision for the controller and at minimum do not leave an unpatched copy.
- Normalize blacklist count with `Number(result.count) || 0`.
- Blind-box API errors must pass through the existing safe API error behavior and not expose Prisma/SQL/stack/path details.
- Escape user-controlled `value` before `blind-box/app.js` writes it into HTML.

Use existing test conventions. Add or update focused frontend contract tests where practical. Before production edits, write a failing test or a static contract assertion and run it red; then implement and run it green. Do not alter unrelated user changes.

Report to `.superpowers/sdd/requirements-plan-2026-08-30/frontend-security-report.md` with changed files, exact tests/commands and results, concerns, and commit hash. Commit the implementation in a focused commit.
