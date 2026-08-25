# 蛋蛋校园认证与验证码实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前仅有认证 API 骨架和前端 Demo 状态的蛋蛋校园，完善为可上线使用的注册、登录、验证码验证、找回密码和会话管理系统。

**Architecture:** 保留蛋蛋校园后端的 Fastify + Prisma + MariaDB 架构。验证码采用后端统一编排、短信/邮件供应商可替换的适配器，验证码只保存哈希值并设置短时过期、次数和消费状态；生产环境优先接入腾讯云 SMS，开发和测试使用可观测的 Mock provider。前端 `growth-school.html` 只调用蛋蛋校园 API，不读取“航线”项目的 Supabase。

**Tech Stack:** Node.js 24、TypeScript、Fastify 5、Prisma 6、MariaDB 10.3、Zod、bcryptjs、JWT、腾讯云短信 SDK（生产）、Vitest、Playwright。

## Global Constraints

- 蛋蛋校园只使用南京 CVM 上的 `dandan_world` MariaDB 和 `server/.env` 的 `DATABASE_URL`。
- 禁止读取、修改、迁移或复用“航线”项目的 Supabase URL、密钥、表和迁移文件。
- MySQL/MariaDB 只监听 `127.0.0.1:3306`，不开放公网 3306。
- 验证码明文不得写入数据库、日志、响应体或聊天；开发环境只能通过受保护的测试 provider 观察验证码。
- 生产密钥（JWT、短信、邮件、数据库）只放 CVM 环境变量或腾讯云密钥管理服务，不提交 Git。
- 所有认证错误对外使用不泄露账号是否存在的通用文案；敏感操作必须有速率限制和审计日志。

## 当前状态评估

- 已有：`POST /api/auth/register`、`POST /api/auth/login`、`POST /api/auth/logout`，密码哈希、JWT access token、数据库会话、用户资料和蛋蛋币 API。
- 未完成：前端仍在 `growth-school.html` 内使用 `REGISTERED_USERS`、`localStorage` 和 Demo 管理员密码；没有真实 API 调用。
- 未完成：没有手机/邮箱验证码表、发送接口、验证接口、频率限制、找回密码、刷新令牌轮换、邮箱/手机验证状态和生产短信供应商。
- 未完成：CVM 尚未完成后端源码上传、Prisma migration、`.env` 配置、进程守护和公网 API 反向代理。

## 文件地图

- Modify: `server/prisma/schema.prisma`，增加验证码、找回密码和验证状态模型。
- Create: Prisma migration named `verification_codes`，生成文件只迁移蛋蛋校园 `dandan_world`。
- Create: `server/src/auth/verification.ts`，验证码生成、哈希、过期和消费规则。
- Create: `server/src/auth/provider.ts`，短信/邮件 provider 接口和 Mock provider。
- Modify: `server/src/auth/validation.ts`，新增验证码和密码找回输入校验。
- Modify: `server/src/app.ts`，验证码发送/验证、注册确认、登录、刷新、找回密码、审计和限流。
- Modify: `server/src/config.ts`、`server/.env.example`，增加 provider、过期时间、限流和 Cookie 配置。
- Create: `server/src/rate-limit.ts`，按 IP、目标账号和操作类型的短窗口限制。
- Create: `server/tests/auth.test.ts`、`server/tests/verification.test.ts`，API 和安全规则测试。
- Modify: `backend-handoff-package/growth-school.html`，将 Demo 登录/注册替换为真实 API 交互。
- Create: `backend-handoff-package/api-client.js`，前端认证 API client；不引入 Supabase client。
- Modify: `server/README.md`、`server/cvm-mysql-setup.md`，记录上线配置和回滚步骤。

### Task 1: 定义注册和验证码产品规则

**Files:**
- Create: `docs/auth-product-rules.md`

**Interfaces:**
- Produces the exact API contract used by Tasks 2-6: phone-first verification, optional email verification, error codes, token lifetimes, and account states.

- [ ] **Step 1: Document the registration flow**

  Define: request verification code -> verify code -> submit nickname/password/profile -> create account. Phone is the first production channel because the current UI and database already have a phone field; email is a second provider path.

- [ ] **Step 2: Document the security rules**

  Use 6 numeric digits, 5-minute expiry, 5 failed attempts per code, one-time consumption, 60-second resend cooldown, 5 sends per target per hour, and 20 sends per IP per hour. Password reset codes must never confirm account existence.

- [ ] **Step 3: Document acceptance cases**

  Include new account, duplicate phone/email, expired code, wrong code, repeated code, rate limited request, suspended account, password reset, logout and refresh-token reuse.

- [ ] **Step 4: Review the contract**

  Confirm all frontend labels and backend error codes match before implementation begins.

### Task 2: Add verification persistence and provider boundary

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: generated Prisma migration `verification_codes`
- Create: `server/src/auth/verification.ts`
- Create: `server/src/auth/provider.ts`
- Modify: `server/src/config.ts`
- Modify: `server/.env.example`
- Test: `server/tests/verification.test.ts`

**Interfaces:**
- `VerificationProvider.send(input: { channel: 'sms' | 'email'; target: string; code: string; purpose: VerificationPurpose }): Promise<void>`.
- `createVerificationCode(input): Promise<{ id: string; expiresAt: Date }>`.
- `consumeVerificationCode(input: { target; purpose; code }): Promise<void>`.

- [ ] **Step 1: Write failing unit tests**

  Test that generated codes have six digits, only the hash is persisted, expired and consumed codes fail, the sixth wrong attempt fails permanently, and a successful consume cannot be repeated.

- [ ] **Step 2: Add Prisma models**

  Add `VerificationCode` with `id`, `channel`, `target`, `purpose`, `codeHash`, `expiresAt`, `attempts`, `consumedAt`, `requestIp`, `createdAt`, plus indexes on `(target, purpose, createdAt)` and `expiresAt`. Add `verifiedPhoneAt` and `verifiedEmailAt` to `User`.

- [ ] **Step 3: Implement provider adapters**

  Implement `MockVerificationProvider` for tests and a `TencentSmsVerificationProvider` interface implementation behind configuration. The provider must receive the code only in memory and must redact target/code in logs.

- [ ] **Step 4: Run the focused tests**

  Run `npm test -- --run server/tests/verification.test.ts` from `server`; expected: PASS.

### Task 3: Implement send/verify endpoints and abuse controls

**Files:**
- Create: `server/src/rate-limit.ts`
- Modify: `server/src/auth/validation.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/config.ts`
- Test: `server/tests/auth.test.ts`

**Interfaces:**
- `POST /api/auth/verification-codes` body `{ channel, target, purpose }` -> `{ ok: true, expiresInSeconds, resendAfterSeconds }`.
- `POST /api/auth/verification-codes/verify` body `{ channel, target, purpose, code }` -> `{ verificationToken }`.

- [ ] **Step 1: Write failing API tests**

  Cover registration and password-reset purposes, generic responses for unknown targets, cooldown, per-target/IP limits, success token issuance, invalid/expired codes, and no code in response/log output.

- [ ] **Step 2: Implement validation and limits**

  Validate mainland phone format and normalized email. Use an in-memory limiter for local tests and a clearly isolated interface for Redis replacement before multi-instance deployment.

- [ ] **Step 3: Implement code send and verify routes**

  Persist the hash, call the configured provider, consume on success, and return a short-lived single-purpose verification token. Never accept a raw “verified” boolean from the frontend.

- [ ] **Step 4: Run tests and typecheck**

  Run `npm test` and `npm run build`; expected: PASS with no TypeScript errors.

### Task 4: Harden registration, login, refresh and password reset

**Files:**
- Modify: `server/src/app.ts`
- Modify: `server/src/auth/validation.ts`
- Modify: `server/prisma/schema.prisma`
- Create: generated Prisma migration `auth_hardening`
- Test: `server/tests/auth.test.ts`

**Interfaces:**
- `POST /api/auth/register` additionally requires a valid short-lived `verificationToken` for phone/email registration.
- `POST /api/auth/refresh` rotates the refresh token and invalidates the previous session token.
- `POST /api/auth/password-reset/request` always returns `{ ok: true }`.
- `POST /api/auth/password-reset/confirm` accepts `{ resetToken, newPassword }` and revokes all existing sessions.

- [ ] **Step 1: Write failing auth tests**

  Test verified registration, unverified registration rejection, refresh rotation/reuse rejection, reset-token single use, password hash replacement, all-session revocation, and generic reset responses.

- [ ] **Step 2: Add token/session fields**

  Add a purpose and expiry to verification/reset token persistence as needed; store only refresh/reset hashes. Keep access tokens short-lived (15 minutes) and refresh sessions bounded (30 days).

- [ ] **Step 3: Implement route behavior**

  Make registration atomic with user, stats, character rows, account and welcome points. Record auth events in `AuditLog`. Return the same generic login error for unknown, suspended and bad-password cases.

- [ ] **Step 4: Configure secure cookies**

  Prefer an HttpOnly, Secure, SameSite refresh cookie in production; keep access tokens in frontend memory. Configure explicit `TRUST_PROXY`, cookie domain and CORS credentials.

- [ ] **Step 5: Run tests**

  Run `npm test`, `npm run build`, `npx prisma format` and `npx prisma validate`; expected: PASS.

### Task 5: Replace the static Demo auth UI with real API integration

**Files:**
- Create: `backend-handoff-package/api-client.js`
- Modify: `backend-handoff-package/growth-school.html`
- Test: `server/tests/frontend-auth-contract.test.ts` or Playwright smoke test

**Interfaces:**
- `apiClient.sendCode(channel, target, purpose)`.
- `apiClient.verifyCode(channel, target, purpose, code)`.
- `apiClient.register(payload, verificationToken)`.
- `apiClient.login(identifier, password)`.
- `apiClient.logout()` and `apiClient.refresh()`.

- [ ] **Step 1: Add failing browser smoke checks**

  Verify that registration no longer writes `REGISTERED_USERS` or passwords to `localStorage`, the code input has a resend cooldown, login errors are rendered, and logout clears in-memory auth state.

- [ ] **Step 2: Add the API client**

  Use `fetch` with the configured API origin, `credentials: 'include'`, JSON error parsing, and one refresh retry on 401. Keep the API origin separate from any Supabase or “航线” configuration.

- [ ] **Step 3: Wire registration UI**

  Add channel selector, phone/email input, send-code button, six-digit code input, countdown, password confirmation and inline validation. Disable submit until verification succeeds.

- [ ] **Step 4: Wire login and logout UI**

  Replace nickname-only Demo lookup with identifier/password API calls, show loading and generic failure states, hydrate `/api/users/me`, and revoke the server session on logout.

- [ ] **Step 5: Verify in browser**

  Run the local preview and Playwright smoke test at desktop and mobile widths. Confirm the existing task plaza remains usable for guests and authenticated users.

### Task 6: Add email/SMS production configuration and operations

**Files:**
- Modify: `server/.env.example`
- Modify: `server/package.json` and `server/package-lock.json` when enabling the Tencent SMS SDK
- Modify: `server/README.md`
- Modify: `server/cvm-mysql-setup.md`
- Create: `server/docs/verification-provider-runbook.md`

- [ ] **Step 1: Configure Tencent SMS without committing secrets**

  Document `TENCENTCLOUD_SECRET_ID`, `TENCENTCLOUD_SECRET_KEY`, SMS app ID, sign name and template ID as CVM-only environment variables. Use a sub-account with the minimum SMS permissions and rotate keys.

- [ ] **Step 2: Define email fallback**

  Keep email provider optional for phase one. Define SMTP/API variables and a template with no sensitive account details; do not silently pretend email delivery works when disabled.

- [ ] **Step 3: Add startup checks**

  In production mode, fail startup if the selected provider is missing required configuration. In development, explicitly label Mock provider output and prevent accidental production use.

- [ ] **Step 4: Add cleanup and monitoring**

  Schedule deletion of expired verification rows, count send failures and verification failures, alert on provider errors, and never log code values.

### Task 7: Deploy to the isolated CVM database and verify end to end

**Files:**
- Modify: `server/.env` on CVM only, never commit
- Deploy: `server/` package to CVM
- Verify: `dandan_world` tables and application health

- [ ] **Step 1: Upload only the蛋蛋校园 backend**

  Exclude `node_modules`, `dist`, `.env`, `.cvm-app-password.local`, all “航线” files and all Supabase credentials. Verify the archive manifest before upload.

- [ ] **Step 2: Configure CVM environment**

  Set `DATABASE_URL` to `127.0.0.1:3306/dandan_world`, a new 32+ character `JWT_SECRET`, API origin/CORS, cookie settings and the selected verification provider variables.

- [ ] **Step 3: Migrate and build**

  Run `npm install`, `npm run prisma:generate`, `npm run prisma:deploy` and `npm run build`. Confirm migrations only target `dandan_world`.

- [ ] **Step 4: Run smoke flows**

  Verify health, send/verify code with Mock provider in staging, register, login, refresh, logout, reset password and authenticated profile access. Verify `SHOW TABLES` contains only蛋蛋校园 schema additions and no Supabase connection is attempted.

- [ ] **Step 5: Add process and rollback controls**

  Run the API under systemd with restart policy, bind the API to localhost behind HTTPS reverse proxy, keep 3306 private, and document migration rollback/backup before production traffic.

### Task 8: Final security and release review

**Files:**
- Create: `docs/auth-release-checklist.md`
- Modify: `server/README.md`

- [ ] **Step 1: Check secrets and data boundaries**

  Scan the archive and repository for passwords, JWT secrets, SMS keys, Supabase URLs and Supabase keys. Any finding blocks release.

- [ ] **Step 2: Check abuse resistance**

  Confirm rate limits, generic errors, code hashing, expiry, single-use behavior, refresh rotation, session revocation, password hashing and audit records.

- [ ] **Step 3: Check browser behavior**

  Confirm mobile layout, resend countdown, loading states, accessible labels, no password/code persistence, and no interference with existing task flows.

- [ ] **Step 4: Sign off deployment**

  Record migration ID, backup location, provider configuration status, test results and the explicit statement: “航线 Supabase 未被读取或修改”。

## Recommended Delivery Order

1. Tasks 1-2: lock the contract and persistence boundary.
2. Tasks 3-4: make the backend authentication production-safe.
3. Task 5: connect the visible website UI.
4. Task 6: enable real SMS/email delivery.
5. Task 7: deploy to the isolated CVM.
6. Task 8: complete release review.

## Definition Of Done

- A new user can request and verify a code, register, log in, refresh a session, log out and reset a password.
- Codes are hashed, short-lived, single-use, rate-limited and absent from logs/responses.
- The existing front-end no longer treats local Demo objects as the source of truth.
- `dandan_world` is the only database touched by the new service; “航线” Supabase remains unchanged.
- Tests, build, Prisma validation, browser smoke checks and CVM health checks pass.
