# 2026-08-28 Isolated Browser Walkthrough

## Scope and environment

- Frontend: `http://127.0.0.1:8900/growth-school.html` served from a temporary copy of `backend-handoff-package`.
- API: isolated SSH tunnel `127.0.0.1:13311` to the remote test service on port `3311`; `GET /health` returned `status: ok`.
- Tooling: one Playwright CLI browser session only. No agent-browser and no screenshots were used.
- Data: isolated test database only. No production site, files, database, upload, or Nginx configuration was changed.

## Browser results

- Anonymous state: the login modal and registration/login affordances rendered after a clean reload.
- Session and identity: login restored the isolated account and the sidebar displayed that account's API nickname with `学业技术 · 新手蛋`; it did not display the static `隐士蛋 · 蛋总` identity. A subsequent reload retained the authenticated session.
- Profile: an empty MBTI rendered as `未设置`; editing school, city, bio, interests, and seven skills saved successfully and refreshed the page from canonical API data.
- Skill boundary: entering eight comma-separated skills previously reached the backend with an invalid request. The frontend now stops the save with `技能标签最多选择 7 个`; seven skills save correctly.
- Task plazas: teaching, help, and team navigation loaded without a white screen. The teaching search narrowed two tasks to the one matching `英语四级`; its details modal rendered publisher, reward, experience reward, claim mode, claim count, and claim action. Empty team state rendered correctly.
- Rankings and public data: the ranking page loaded real isolated users. Missing MBTI fields rendered as `—`, not fabricated identities.
- Notifications: the bell panel opened and rendered `消息通知 / 全部已读 / 暂无通知` without an exception.
- Gossip: the gossip page loaded, its publish form opened, and tag/filter controls were present and clickable. No `selectedGossipTag` runtime exception occurred.
- Blind box: the `blind-box/` iframe loaded through the same-origin test proxy. Preference, draw, message, friend-application, inbox, recommendation, and feature entry points rendered with no CORS or JavaScript errors.
- Feedback: the floating feedback control opened on desktop and mobile; a test ticket submitted successfully and returned the success confirmation.
- Mobile: at `390 x 844`, the feedback button measured `44 x 44` at left `14px` and did not overlap the task card. The search field is intentionally hidden by the narrow layout, while the task page and feedback entry remain usable.
- Console: after the proxy was corrected to same-origin `/dd`, Playwright reported zero error-level console messages during the authenticated walkthrough.

## Continuation run: logout regression

- The latest source copy was rebuilt into the temporary browser root before retesting; no production file was used as the test target.
- A fresh isolated student account was registered through the test service, logged in, and confirmed in the sidebar. The rendered identity matched the API nickname and showed the correct student egg label.
- The normal `退出` flow now sends `POST /dd/api/auth/refresh` with `200`, followed by `POST /dd/api/auth/logout` with `200`. There was no logout `401` in the new request sequence.
- The previous implementation emitted `logout 401 -> refresh 200 -> logout 200` when its in-memory bearer had expired. `backend-handoff-package/api-client.js` now refreshes once before logout and clears local auth state in `finally`.
- The isolated test database still contains historical `[demo]` task rows documented in the HANDOFF. These were returned by the test API; the frontend source contains no static demo task log or static `隐士蛋 · 蛋总` identity.

## Automated verification

- Focused contracts after the task-card change: `22 / 22` passed.
- Focused profile/invitation contracts after the skill-limit change: `41 / 41` passed.
- Final full server suite after the release-boundary safeguards: `53` test files and `315` tests passed.
- Auth contract after the logout fix: `29 / 29` passed.
- TypeScript build: `npm.cmd run build` passed.
- Release verification: the active r2 manifest passes isolated verification, while both superseded r1 and isolated-only r2 are rejected in production mode.
- Deployment script syntax: `bash -n deploy-frontend.sh` passed with Git Bash; no deployment command was executed.

## Changes made during this walkthrough

- `backend-handoff-package/growth-school.html` now displays server-supplied `publishExpReward` in dynamically loaded task cards and supplies the task-card semantic classes required by the task plaza contract.
- The profile editor now validates the seven-skill maximum before submitting to the API, matching the server rule and preventing the generic validation failure seen in browser testing.
- `backend-handoff-package/api-client.js` refreshes the cookie session before server logout to avoid a transient expired-bearer `401`; the matching frontend auth contract was updated.
- `.walkthrough-harness/prepare-www.ps1` now injects same-origin `/dd` for the isolated proxy, preventing CORS-only test failures.

## Coverage boundary

One browser identity cannot independently complete every role transition in a task lifecycle. Publisher approval, claimer completion, mutual ratings, invitations received by another account, and adopted gossip replies remain covered by the isolated server integration/contract suite. No deployment claim is implied by this report.

The current r2 manifest remains `isolated-test-only` and `productionDeployable: false`. No production upload or Nginx reload was performed during this walkthrough and verification cycle.
